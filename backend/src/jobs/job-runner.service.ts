import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { BrowserContext, Page } from 'playwright';
import { ActionRunner } from '../actions/action-runner.js';
import { errorMessage } from '../actions/handlers/handler.js';
import {
  ActionError,
  RunContext,
  RunHooks,
  StopSignal,
} from '../actions/run-context.js';
import { ArtifactsService } from '../artifacts/artifacts.service.js';
import { BrowserPoolService, ContextLease } from '../browser/browser-pool.service.js';
import { ProfileLease, ProfilesService } from '../profiles/profiles.service.js';
import { Semaphore } from '../common/semaphore.js';
import {
  Events,
  TaskLogEvent,
  TaskPageEvent,
  TaskUpdatedEvent,
} from '../common/events.js';
import {
  emptyTotals,
  Job,
  JobStatus,
  Task,
  TaskLog,
  TaskStatus,
  Totals,
} from './schemas.js';

type LeanJob = Job & { _id: Types.ObjectId };
type LeanTask = Task & { _id: Types.ObjectId };

interface RunningJob {
  id: string;
  job: LeanJob;
  abort: AbortController;
  slots: Semaphore;
  totals: Totals;
}

/** What other services (screencast, takeover, pause/resume, cancel) can reach of a task. */
export interface ActiveTask {
  taskId: string;
  jobId: string;
  abort: AbortController;
  context?: BrowserContext;
  page?: Page;
  ctx?: RunContext;
  /** Set only while the task is paused. */
  resume?: () => void;
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

type Outcome = 'done' | 'failed' | 'cancelled' | 'retry';

/**
 * Executes jobs in-process: every task of a job runs through a per-job
 * semaphore (job.concurrency) and then the global browser pool. Task state
 * lives in Mongo and every change is emitted as an internal event for the
 * live gateway.
 */
@Injectable()
export class JobRunnerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobRunnerService.name);
  private readonly running = new Map<string, RunningJob>();
  private readonly active = new Map<string, ActiveTask>();

  constructor(
    @InjectModel(Job.name) private readonly jobs: Model<Job>,
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    @InjectModel(TaskLog.name) private readonly logs: Model<TaskLog>,
    private readonly pool: BrowserPoolService,
    private readonly artifacts: ArtifactsService,
    private readonly profiles: ProfilesService,
    private readonly events: EventEmitter2,
  ) {}

  /** Nothing survives a restart: close out whatever was left unfinished. */
  async onApplicationBootstrap() {
    const stale = await this.jobs.find({ status: { $in: ['queued', 'running'] } }, { _id: 1 }).lean();
    if (!stale.length) return;
    const ids = stale.map((j) => j._id);
    await this.tasks.updateMany(
      { jobId: { $in: ids }, status: { $in: ['queued', 'running', 'paused'] } },
      { status: 'cancelled', error: { message: 'Server restarted' }, finishedAt: new Date() },
    );
    for (const id of ids) {
      await this.jobs.updateOne(
        { _id: id },
        { status: 'cancelled', totals: await this.countTotals(id), finishedAt: new Date() },
      );
    }
    this.logger.warn(`Marked ${ids.length} unfinished job(s) from a previous run as cancelled`);
  }

  async onModuleDestroy() {
    for (const run of this.running.values()) run.abort.abort(new CancelledError());
  }

  isRunning(jobId: string) {
    return this.running.has(jobId);
  }

  getActive(taskId: string): ActiveTask | undefined {
    return this.active.get(taskId);
  }

  /** Starts (or restarts after `retry`) every queued task of a job. */
  async start(jobId: string) {
    if (this.running.has(jobId)) return;
    const job = await this.jobs.findById(jobId).lean<LeanJob>();
    if (!job) return;
    const queued = await this.tasks
      .find({ jobId: job._id, status: 'queued' })
      .sort({ index: 1 })
      .lean<LeanTask[]>();

    const run: RunningJob = {
      id: jobId,
      job,
      abort: new AbortController(),
      slots: new Semaphore(job.concurrency),
      totals: await this.countTotals(job._id),
    };
    this.running.set(jobId, run);
    await this.updateJob(run, 'running', {
      startedAt: job.startedAt ?? new Date(),
      finishedAt: null,
    });
    this.logger.log(`Job ${jobId}: ${queued.length} task(s), concurrency ${job.concurrency}`);

    void Promise.allSettled(queued.map((t) => this.runTask(run, t))).then(() =>
      this.finish(run),
    );
  }

  cancelJob(jobId: string): boolean {
    const run = this.running.get(jobId);
    run?.abort.abort(new CancelledError());
    return !!run;
  }

  cancelTask(taskId: string): boolean {
    const entry = this.active.get(taskId);
    entry?.abort.abort(new CancelledError());
    return !!entry;
  }

  /** Pauses a running task before its next step (takeover from the UI). */
  pauseTask(taskId: string): boolean {
    const entry = this.active.get(taskId);
    if (!entry?.ctx || entry.resume) return false;
    entry.ctx.pauseRequest = 'Paused from the UI';
    return true;
  }

  resumeTask(taskId: string): boolean {
    const resume = this.active.get(taskId)?.resume;
    resume?.();
    return !!resume;
  }

  private async runTask(run: RunningJob, task: LeanTask) {
    const taskId = String(task._id);
    const abort = new AbortController();
    const onJobAbort = () => abort.abort(run.abort.signal.reason);
    if (run.abort.signal.aborted) onJobAbort();
    else run.abort.signal.addEventListener('abort', onJobAbort, { once: true });
    const entry: ActiveTask = { taskId, jobId: run.id, abort };
    this.active.set(taskId, entry);
    try {
      let attempt = task.attempt;
      while ((await this.attempt(run, task, entry, ++attempt)) === 'retry') {
        await this.setTask(run, task, 'queued', { attempt });
      }
    } catch (err) {
      // Only bookkeeping (Mongo) can land here.
      this.logger.error(`Task ${taskId}: ${errorMessage(err)}`);
    } finally {
      run.abort.signal.removeEventListener('abort', onJobAbort);
      this.active.delete(taskId);
    }
  }

  private async attempt(
    run: RunningJob,
    task: LeanTask,
    entry: ActiveTask,
    attempt: number,
  ): Promise<Outcome> {
    const { job } = run;
    const { signal } = entry.abort;
    let releaseSlot: (() => void) | undefined;
    let lease: ContextLease | undefined;
    let profile: ProfileLease | undefined;
    const closeOnAbort = () => void lease?.release();
    try {
      releaseSlot = await run.slots.acquire(signal);
      // Folder profiles open their Chrome user-data dir; session profiles a
      // fresh context preloaded with the saved cookies / localStorage.
      profile = job.profileId ? await this.profiles.leaseFor(String(job.profileId)) : undefined;
      lease = await this.pool.lease({
        headless: job.headless,
        emulation: job.emulation ?? {},
        profileId: profile?.profileId,
        storageState: profile?.storageState,
        signal,
      });
      // Closing the context makes any in-flight Playwright call fail fast.
      signal.addEventListener('abort', closeOnAbort, { once: true });
      signal.throwIfAborted();

      const { context } = lease;
      context.setDefaultTimeout(job.stepTimeout);
      context.setDefaultNavigationTimeout(Math.max(job.stepTimeout, 30_000));
      const page = context.pages()[0] ?? (await context.newPage());
      entry.context = context;

      await this.setTask(run, task, 'running', {
        attempt,
        startedAt: new Date(),
        finishedAt: null,
        error: null,
        result: null,
        currentStep: null,
      });
      const ctx = new RunContext(
        context,
        page,
        structuredClone(task.vars ?? {}),
        this.hooks(run, task, entry, attempt),
        signal,
      );
      entry.ctx = ctx;
      this.trackPage(run, task, entry, page);
      try {
        await new ActionRunner(ctx).run(job.actions);
      } catch (err) {
        if (!(err instanceof StopSignal)) throw err;
      }
      await this.setTask(run, task, 'done', {
        result: ctx.result,
        finishedAt: new Date(),
        currentStep: null,
      });
      return 'done';
    } catch (err) {
      if (signal.aborted) {
        await this.setTask(run, task, 'cancelled', {
          finishedAt: new Date(),
          error: { message: 'Cancelled' },
        });
        return 'cancelled';
      }
      const error = {
        message: err instanceof ActionError ? err.message : errorMessage(err),
        stepPath: err instanceof ActionError ? err.path : undefined,
        actionType: err instanceof ActionError ? err.actionType : undefined,
        screenshot: await this.failureScreenshot(run, task, entry),
      };
      if (attempt <= job.maxRetries) {
        this.emitLog(run, task, attempt, {
          path: '-',
          type: 'retry',
          status: 'error',
          message: `Attempt ${attempt} failed, retrying: ${error.message}`,
          durationMs: 0,
        });
        return 'retry';
      }
      await this.setTask(run, task, 'failed', { error, finishedAt: new Date() });
      return 'failed';
    } finally {
      signal.removeEventListener('abort', closeOnAbort);
      entry.context = entry.page = entry.ctx = entry.resume = undefined;
      this.emitPage(task);
      if (lease && profile?.mode === 'session') await this.keepSession(String(job.profileId), lease);
      await lease?.release();
      releaseSlot?.();
    }
  }

  /** Session profiles: store the cookies the task ended with (refreshed logins, new tokens). */
  private async keepSession(profileId: string, lease: ContextLease) {
    try {
      await this.profiles.saveSession(profileId, await lease.context.storageState());
    } catch (err) {
      // Context already closed (cancelled task): keep the previous session.
      this.logger.debug(`Session of profile ${profileId} not saved: ${errorMessage(err)}`);
    }
  }

  private hooks(run: RunningJob, task: LeanTask, entry: ActiveTask, attempt: number): RunHooks {
    const taskId = String(task._id);
    return {
      onStepStart: (path) => this.emitTask(run, task, { currentStep: path }),
      onStep: (log) => this.emitLog(run, task, attempt, log),
      onPageChange: (page) => this.trackPage(run, task, entry, page),
      saveArtifact: (input) => this.artifacts.save(run.id, taskId, input),
      pause: async (message) => {
        await this.setTask(run, task, 'paused', { pauseMessage: message ?? 'Paused' });
        await new Promise<void>((resolve, reject) => {
          const { signal } = entry.abort;
          const onAbort = () => reject(signal.reason);
          signal.addEventListener('abort', onAbort, { once: true });
          entry.resume = () => {
            signal.removeEventListener('abort', onAbort);
            entry.resume = undefined;
            resolve();
          };
        });
        await this.setTask(run, task, 'running', { pauseMessage: null });
      },
    };
  }

  private trackPage(run: RunningJob, task: LeanTask, entry: ActiveTask, page: Page) {
    if (entry.page === page) return;
    entry.page = page;
    this.emitPage(task);
    const report = () => {
      if (entry.page !== page) return;
      const currentUrl = page.url();
      void this.tasks.updateOne({ _id: task._id }, { currentUrl }).catch(() => undefined);
      this.emitTask(run, task, { currentUrl });
    };
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) report();
    });
    report();
  }

  private async failureScreenshot(run: RunningJob, task: LeanTask, entry: ActiveTask) {
    if (!entry.page || entry.page.isClosed()) return undefined;
    try {
      const data = await entry.page.screenshot({ timeout: 5_000 });
      return await this.artifacts.save(run.id, String(task._id), {
        kind: 'screenshot',
        name: 'error',
        ext: 'png',
        mime: 'image/png',
        data,
      });
    } catch {
      return undefined;
    }
  }

  private async setTask(
    run: RunningJob,
    task: LeanTask,
    status: TaskStatus,
    patch: Record<string, unknown> = {},
  ) {
    const prev = task.status;
    task.status = status;
    await this.tasks.updateOne({ _id: task._id }, { status, ...patch });
    this.emitTask(run, task, { status, ...patch });
    if (prev !== status) {
      run.totals[prev]--;
      run.totals[status]++;
      await this.updateJob(run, undefined, { totals: run.totals });
    }
  }

  private emitTask(run: RunningJob, task: LeanTask, patch: Record<string, unknown>) {
    const event: TaskUpdatedEvent = { _id: String(task._id), jobId: run.id, ...patch };
    this.events.emit(Events.TaskUpdated, event);
  }

  private emitPage(task: LeanTask) {
    const event: TaskPageEvent = { taskId: String(task._id) };
    this.events.emit(Events.TaskPage, event);
  }

  private emitLog(
    run: RunningJob,
    task: LeanTask,
    attempt: number,
    log: Omit<TaskLogEvent, 'taskId' | 'jobId' | 'attempt' | 'ts'>,
  ) {
    const event: TaskLogEvent = {
      ...log,
      taskId: String(task._id),
      jobId: run.id,
      attempt,
      ts: new Date(),
    };
    void this.logs
      .create({ ...event, taskId: task._id, jobId: run.job._id })
      .catch((err) => this.logger.warn(`Log write failed: ${errorMessage(err)}`));
    this.events.emit(Events.TaskLog, event);
  }

  private async updateJob(
    run: RunningJob,
    status: JobStatus | undefined,
    patch: Record<string, unknown>,
  ) {
    const set = status ? { status, ...patch } : patch;
    await this.jobs.updateOne({ _id: run.job._id }, set);
    this.events.emit(Events.JobUpdated, { _id: run.id, ...set });
  }

  private async finish(run: RunningJob) {
    const status: JobStatus = run.abort.signal.aborted
      ? 'cancelled'
      : run.totals.failed > 0
        ? 'failed'
        : 'done';
    this.running.delete(run.id);
    try {
      await this.updateJob(run, status, {
        totals: await this.countTotals(run.job._id),
        finishedAt: new Date(),
      });
    } catch (err) {
      this.logger.error(`Job ${run.id} finish: ${errorMessage(err)}`);
    }
    this.logger.log(`Job ${run.id} ${status}`);
  }

  async countTotals(jobId: Types.ObjectId): Promise<Totals> {
    const rows = await this.tasks.aggregate<{ _id: TaskStatus; n: number }>([
      { $match: { jobId } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const totals = emptyTotals();
    for (const r of rows) totals[r._id] = r.n;
    return totals;
  }
}
