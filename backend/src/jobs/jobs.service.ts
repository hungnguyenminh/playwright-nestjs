import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { assertValidActions } from '../actions/action-validator.js';
import { ArtifactsService } from '../artifacts/artifacts.service.js';
import { mergeEmulation } from '../browser/emulation.js';
import { Page, PageQuery } from '../common/pagination.js';
import { appConfig, type AppConfig } from '../config/app.config.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { ScriptsService } from '../scripts/scripts.service.js';
import { CreateJobDto } from './job.dto.js';
import { JobRunnerService } from './job-runner.service.js';
import { emptyTotals, Job, Task, TaskLog } from './schemas.js';

const oid = (id: string) => new Types.ObjectId(id);

async function paginate<T>(
  model: Model<T>,
  filter: Record<string, unknown>,
  q: PageQuery,
  sort: Record<string, 1 | -1>,
  projection?: Record<string, 0 | 1>,
): Promise<Page<T>> {
  if (q.status) filter.status = { $in: q.status.split(',') };
  const [items, total] = await Promise.all([
    model
      .find(filter, projection)
      .sort(sort)
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean<T[]>(),
    model.countDocuments(filter),
  ]);
  return { items, total, page: q.page, limit: q.limit };
}

@Injectable()
export class JobsService {
  constructor(
    @InjectModel(Job.name) private readonly jobs: Model<Job>,
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    @InjectModel(TaskLog.name) private readonly logs: Model<TaskLog>,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
    private readonly scripts: ScriptsService,
    private readonly profiles: ProfilesService,
    private readonly artifacts: ArtifactsService,
    private readonly runner: JobRunnerService,
  ) {}

  async create(dto: CreateJobDto) {
    const script = dto.scriptId ? await this.scripts.get(dto.scriptId) : undefined;
    const actions = dto.actions ?? script?.actions;
    if (!actions) throw new BadRequestException('Provide scriptId or actions');
    assertValidActions(actions);
    if (!actions.length) throw new BadRequestException('Script has no actions');

    const inputs = dto.inputs?.length ? dto.inputs : [{}];
    const profileEmulation = dto.profileId
      ? await this.profiles.emulationFor(dto.profileId)
      : undefined;

    const job = await this.jobs.create({
      name: dto.name || script?.name || 'Ad-hoc job',
      scriptId: script?._id,
      flowId: dto.flowId ? oid(dto.flowId) : undefined,
      actions,
      emulation: mergeEmulation(script?.emulation, profileEmulation, dto.emulation),
      profileId: dto.profileId ? oid(dto.profileId) : undefined,
      // A profile can only be open once, so its tasks run one after another.
      concurrency: dto.profileId ? 1 : Math.min(dto.concurrency ?? 3, inputs.length),
      headless: dto.headless ?? this.config.headless,
      maxRetries: dto.maxRetries ?? 0,
      stepTimeout: dto.stepTimeout ?? 30_000,
      totals: { ...emptyTotals(), queued: inputs.length },
    });
    await this.tasks.insertMany(
      inputs.map((input, index) => ({
        jobId: job._id,
        index,
        name: String(input.name ?? `#${index + 1}`),
        vars: { ...script?.defaultVars, ...dto.vars, ...input },
      })),
    );
    await this.runner.start(String(job._id));
    return job.toObject();
  }

  list(q: PageQuery, flowId?: string) {
    return paginate(this.jobs, flowId ? { flowId: oid(flowId) } : {}, q, { createdAt: -1 }, { actions: 0 });
  }

  async get(id: string) {
    const job = await this.jobs.findById(id).lean();
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  listTasks(jobId: string, q: PageQuery) {
    return paginate(this.tasks, { jobId: oid(jobId) }, q, { index: 1 });
  }

  async cancel(id: string) {
    await this.get(id);
    if (!this.runner.cancelJob(id)) throw new ConflictException('Job is not running');
  }

  /**
   * Re-queues failed and cancelled tasks and runs them again. With
   * `useLatestScript`, the job first takes the script's current actions
   * (e.g. after fixing it) instead of the snapshot taken at creation.
   */
  async retry(id: string, useLatestScript = false) {
    const job = await this.get(id);
    if (this.runner.isRunning(id)) throw new ConflictException('Job is still running');
    if (useLatestScript) {
      if (!job.scriptId) throw new BadRequestException('Job này chạy inline actions, không gắn với script nào');
      const script = await this.scripts.get(String(job.scriptId));
      assertValidActions(script.actions);
      await this.jobs.updateOne({ _id: job._id }, { actions: script.actions });
    }
    const res = await this.tasks.updateMany(
      { jobId: oid(id), status: { $in: ['failed', 'cancelled'] } },
      { status: 'queued', error: null, finishedAt: null },
    );
    if (!res.modifiedCount) throw new BadRequestException('No failed tasks to retry');
    await this.runner.start(id);
    return { requeued: res.modifiedCount };
  }

  async remove(id: string) {
    if (this.runner.isRunning(id)) throw new ConflictException('Cancel the job first');
    const res = await this.jobs.deleteOne({ _id: id });
    if (!res.deletedCount) throw new NotFoundException('Job not found');
    await Promise.all([
      this.tasks.deleteMany({ jobId: oid(id) }),
      this.logs.deleteMany({ jobId: oid(id) }),
      this.artifacts.removeByJob(id),
    ]);
  }

  async getTask(id: string) {
    const task = await this.tasks.findById(id).lean();
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  taskLogs(taskId: string) {
    return this.logs
      .find({ taskId: oid(taskId) }, { taskId: 0, jobId: 0 })
      .sort({ ts: 1, _id: 1 })
      .limit(5_000)
      .lean();
  }

  taskArtifacts(taskId: string) {
    return this.artifacts.listByTask(taskId);
  }

  async cancelTask(id: string) {
    await this.getTask(id);
    if (!this.runner.cancelTask(id)) throw new ConflictException('Task is not running');
  }

  async pauseTask(id: string) {
    await this.getTask(id);
    if (!this.runner.pauseTask(id)) throw new ConflictException('Task is not running');
  }

  async resumeTask(id: string) {
    await this.getTask(id);
    if (!this.runner.resumeTask(id)) throw new ConflictException('Task is not paused');
  }
}
