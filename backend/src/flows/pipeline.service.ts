import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { errorMessage } from '../actions/handlers/handler.js';
import { Events, type JobUpdatedEvent } from '../common/events.js';
import { DataRecord } from '../data/data-record.schema.js';
import { ActivityService } from '../activity/activity.service.js';
import { Job } from '../jobs/schemas.js';
import { PostGeneratorService } from '../posts/post-generator.service.js';
import { Post } from '../posts/post.schema.js';
import { Flow, FlowRun } from './flow.schema.js';
import { FlowsService, nextAutoRun } from './flows.service.js';

const DEFAULT_TICK_MS = 30_000;
/** Wait after the last job ends before counting new rows (they are saved asynchronously). */
const SETTLE_MS = 3_000;
const FINISHED = ['done', 'failed', 'cancelled'];
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Follows runs of source / pipeline flows: when every crawl job of a run has
 * ended it counts the new rows and, for crawl → publish flows, has the AI
 * write posts from them (the flow's campaign then publishes them). Also starts
 * flows on their auto-run schedule.
 */
@Injectable()
export class PipelineService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PipelineService.name);
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  /** Runs being finished right now (an event and a tick may race). */
  private readonly busy = new Set<string>();
  private readonly tickMs = Number(process.env.FLOW_TICK_MS) || DEFAULT_TICK_MS;

  constructor(
    @InjectModel(Flow.name) private readonly flows: Model<Flow>,
    @InjectModel(FlowRun.name) private readonly runs: Model<FlowRun>,
    @InjectModel(Job.name) private readonly jobs: Model<Job>,
    @InjectModel(DataRecord.name) private readonly records: Model<DataRecord>,
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    private readonly flowsService: FlowsService,
    private readonly generator: PostGeneratorService,
    private readonly activity: ActivityService,
  ) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    setTimeout(() => void this.tick(), 1_500);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  @OnEvent(Events.JobUpdated, { async: true })
  async onJob(e: JobUpdatedEvent) {
    if (!FINISHED.includes(String(e.status))) return;
    const job = await this.jobs.findById(e._id, { runId: 1 }).lean();
    if (!job?.runId) return;
    // Rows of the last task are saved by DataService on the same event: give it a moment.
    setTimeout(() => void this.finishRun(job.runId!).catch((err) => this.logger.error(`Run ${job.runId}: ${errorMessage(err)}`)), SETTLE_MS);
  }

  async tick(now = new Date()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // Runs whose end was missed (restart, event lost) and runs left mid-way.
      for (const r of await this.runs.find({ status: { $in: ['crawling', 'generating'] } }, { runId: 1 }).lean()) {
        await this.finishRun(r.runId).catch((err) => this.logger.error(`Run ${r.runId}: ${errorMessage(err)}`));
      }
      await this.autoRun(now);
    } finally {
      this.ticking = false;
    }
  }

  /** Flows due to run by themselves. A run still going → skip this turn; a late one runs once (no pile-up). */
  private async autoRun(now: Date) {
    const due = await this.flows.find({ 'autoRun.enabled': true, 'autoRun.nextRunAt': { $lte: now } }).lean();
    for (const f of due) {
      const next = nextAutoRun(f.autoRun!, now);
      await this.flows.updateOne({ _id: f._id }, { 'autoRun.nextRunAt': next });
      if (await this.runs.exists({ flowId: f._id, status: { $in: ['crawling', 'generating'] } })) {
        this.logger.log(`Flow ${f.name}: previous run still going, skipping this turn`);
        continue;
      }
      this.activity.log({ actor: 'system', category: 'flow', action: 'flow.autoRun', summary: `Tự chạy luồng "${f.name}"`, target: { type: 'flow', id: f._id, name: f.name } });
      await this.flowsService.run(String(f._id), {}, 'auto').catch((err) => this.logger.warn(`Auto-run of ${f.name} failed: ${errorMessage(err)}`));
    }
  }

  async finishRun(runId: Types.ObjectId) {
    const key = String(runId);
    if (this.busy.has(key)) return;
    this.busy.add(key);
    try {
      const run = await this.runs.findOne({ runId }).lean();
      if (!run || !['crawling', 'generating'].includes(run.status)) return;
      if (run.status === 'crawling') {
        const jobs = await this.jobs.find({ runId }, { status: 1 }).lean();
        if (jobs.some((j) => !FINISHED.includes(j.status))) return;
        const flow = await this.flows.findById(run.flowId).lean();
        const newRecords = await this.records.countDocuments({ scope: `flow:${run.flowId}`, firstSeenAt: { $gte: run.startedAt } });
        if (flow?.kind !== 'pipeline') {
          const allFailed = jobs.length > 0 && jobs.every((j) => j.status !== 'done');
          await this.runs.updateOne({ _id: run._id }, { status: allFailed ? 'failed' : 'done', newRecords, finishedAt: new Date(), ...(allFailed ? { error: 'Mọi job kéo dữ liệu đều lỗi' } : {}) });
          return;
        }
        await this.runs.updateOne({ _id: run._id }, { status: 'generating', newRecords });
      }
      await this.generate(run.runId);
    } finally {
      this.busy.delete(key);
      await this.logRun(runId).catch(() => undefined);
    }
  }

  /** One activity line per finished run (marked so it is written once). */
  private async logRun(runId: Types.ObjectId) {
    const res = await this.runs.updateOne({ runId, status: { $in: ['done', 'failed'] }, logged: { $ne: true } }, { $set: { logged: true } });
    if (!res.modifiedCount) return;
    const run = await this.runs.findOne({ runId }).lean();
    const flow = run && (await this.flows.findById(run.flowId, { name: 1, kind: 1 }).lean());
    if (!run || !flow) return;
    const posts = flow.kind === 'pipeline' ? `, AI viết ${run.postsCreated} bài` : '';
    this.activity.log({
      actor: 'system',
      level: run.status === 'failed' ? 'error' : 'info',
      category: flow.kind === 'pipeline' ? 'pipeline' : 'crawl',
      action: `flowRun.${run.status}`,
      summary: `Luồng "${flow.name}" ${run.status === 'failed' ? 'lỗi' : 'kéo xong'}: ${run.newRecords} dòng mới${posts}${run.error ? ` · ${run.error.slice(0, 200)}` : ''}`,
      target: { type: 'flow', id: flow._id, name: flow.name },
      details: { jobs: run.jobs, newRecords: run.newRecords, postsCreated: run.postsCreated, skipped: run.skipped, trigger: run.trigger },
    });
  }

  /** Writes posts from the run's new rows that have no post yet (safe to repeat after a restart). */
  private async generate(runId: Types.ObjectId) {
    const run = await this.runs.findOne({ runId }).lean();
    const flow = run && (await this.flows.findById(run.flowId).lean());
    if (!run || !flow?.generate) {
      if (run) await this.runs.updateOne({ _id: run._id }, { status: 'failed', error: 'Luồng không còn cấu hình viết bài', finishedAt: new Date() });
      return;
    }
    const g = flow.generate;
    const filter: Record<string, unknown> = { scope: `flow:${flow._id}`, firstSeenAt: { $gte: run.startedAt } };
    if (g.filter?.datasets?.length) filter.dataset = { $in: g.filter.datasets };
    if (g.filter?.q?.trim()) filter.text = { $regex: escapeRegex(g.filter.q.trim().toLowerCase()) };
    if (g.filter?.requireImage) filter['data.image'] = { $regex: '^https?://' };
    const candidates = await this.records.find(filter, { _id: 1 }).sort({ firstSeenAt: 1 }).limit(500).lean();
    const used = new Set(
      (await this.posts.find({ 'sourceRecords.recordId': { $in: candidates.map((c) => c._id) } }, { sourceRecords: 1 }).lean()).flatMap((p) =>
        p.sourceRecords.map((s) => String(s.recordId)),
      ),
    );
    const perPost = g.mode === 'digest' ? (g.digestSize ?? 5) : 1;
    const ids = candidates
      .filter((c) => !used.has(String(c._id)))
      .slice(0, g.maxPostsPerRun * perPost)
      .map((c) => String(c._id));
    if (!ids.length) {
      await this.runs.updateOne({ _id: run._id }, { status: 'done', postsCreated: 0, finishedAt: new Date() });
      return;
    }
    try {
      const res = await this.generator.generate(
        {
          recordIds: ids,
          platforms: g.platforms,
          mode: g.mode,
          digestSize: g.digestSize,
          prompt: g.prompt,
          tone: g.tone,
          length: g.length,
          language: g.language,
          attachImage: g.attachImage,
          approval: g.approval,
          tags: [flow.name],
        },
        { flowId: flow._id },
      );
      const created = await this.posts.countDocuments({ flowId: flow._id, createdAt: { $gte: run.startedAt } });
      await this.runs.updateOne(
        { _id: run._id },
        {
          status: res.errors.length && !res.created.length ? 'failed' : 'done',
          postsCreated: created,
          skipped: res.skipped.length,
          ...(res.errors.length ? { error: res.errors.join('; ').slice(0, 1000) } : {}),
          finishedAt: new Date(),
        },
      );
    } catch (err) {
      await this.runs.updateOne({ _id: run._id }, { status: 'failed', error: errorMessage(err), finishedAt: new Date() });
    }
  }
}
