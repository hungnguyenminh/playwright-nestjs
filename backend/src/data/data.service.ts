import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation, Model, Types } from 'mongoose';
import { errorMessage } from '../actions/handlers/handler.js';
import { Events, type TaskUpdatedEvent } from '../common/events.js';
import { Page } from '../common/pagination.js';
import { Flow } from '../flows/flow.schema.js';
import { Job, Task } from '../jobs/schemas.js';
import { Script } from '../scripts/script.schema.js';
import { DataRecord, ScopeType } from './data-record.schema.js';
import { columnsOf, searchText, toCsv, toRecords } from './records.js';

export interface DatasetSummary {
  scope: string;
  scopeType: ScopeType;
  scopeName: string;
  dataset: string;
  count: number;
  lastSeenAt: Date;
}

/** Columns are sampled from this many rows of a dataset. */
const COLUMN_SAMPLE = 300;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Keeps what tasks collect: every finished task's result is split into rows
 * (records.ts) and upserted per flow / script, so re-runs merge instead of
 * duplicating and the data outlives its jobs.
 */
@Injectable()
export class DataService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DataService.name);

  constructor(
    @InjectModel(DataRecord.name) private readonly records: Model<DataRecord>,
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    @InjectModel(Job.name) private readonly jobs: Model<Job>,
    @InjectModel(Script.name) private readonly scripts: Model<Script>,
    @InjectModel(Flow.name) private readonly flows: Model<Flow>,
  ) {}

  /** First start with this feature: import what earlier tasks already collected. */
  async onApplicationBootstrap() {
    if ((await this.records.estimatedDocumentCount()) > 0) return;
    let rows = 0;
    for await (const task of this.tasks.find({ status: 'done', result: { $ne: null } }, { _id: 1 }).lean()) {
      rows += await this.ingestTask(String(task._id)).catch(() => 0);
    }
    if (rows) this.logger.log(`Imported ${rows} record(s) from earlier tasks`);
  }

  @OnEvent(Events.TaskUpdated, { async: true })
  async onTaskUpdated(e: TaskUpdatedEvent) {
    if (e.status !== 'done') return;
    await this.ingestTask(e._id).catch((err) => this.logger.warn(`Saving data of task ${e._id} failed: ${errorMessage(err)}`));
  }

  /** Upserts the rows of one finished task; returns how many. */
  async ingestTask(taskId: string): Promise<number> {
    const task = await this.tasks.findById(taskId).lean();
    if (!task?.result) return 0;
    const rows = toRecords(task.result, task);
    if (!rows.length) return 0;
    const job = await this.jobs.findById(task.jobId, { name: 1, scriptId: 1, flowId: 1 }).lean();
    const scope = await this.scopeOf(job, task.jobId);
    const now = new Date();
    const ops: AnyBulkWriteOperation<DataRecord>[] = rows.map((r) => ({
      updateOne: {
        filter: { scope: scope.scope, dataset: r.dataset, key: r.key },
        update: {
          $set: {
            scopeType: scope.type,
            scopeName: scope.name,
            data: r.data,
            text: searchText(r.data),
            flowId: job?.flowId,
            scriptId: job?.scriptId,
            jobId: task.jobId,
            taskId: task._id,
            taskName: task.name,
            lastSeenAt: now,
          },
          $setOnInsert: { firstSeenAt: now },
          $inc: { seenCount: 1 },
        },
        upsert: true,
      },
    }));
    await this.records.bulkWrite(ops, { ordered: false });
    return rows.length;
  }

  private async scopeOf(
    job: { name?: string; scriptId?: Types.ObjectId; flowId?: Types.ObjectId } | null,
    jobId: Types.ObjectId,
  ): Promise<{ scope: string; type: ScopeType; name: string }> {
    if (job?.flowId) {
      const flow = await this.flows.findById(job.flowId, { name: 1 }).lean();
      return { scope: `flow:${job.flowId}`, type: 'flow', name: flow?.name ?? job.name ?? '' };
    }
    if (job?.scriptId) {
      const script = await this.scripts.findById(job.scriptId, { name: 1 }).lean();
      return { scope: `script:${job.scriptId}`, type: 'script', name: script?.name ?? job.name ?? '' };
    }
    return { scope: `job:${jobId}`, type: 'job', name: job?.name ?? '' };
  }

  datasets(): Promise<DatasetSummary[]> {
    return this.records.aggregate<DatasetSummary>([
      { $sort: { lastSeenAt: 1 } },
      {
        $group: {
          _id: { scope: '$scope', dataset: '$dataset' },
          scopeType: { $last: '$scopeType' },
          scopeName: { $last: '$scopeName' },
          count: { $sum: 1 },
          lastSeenAt: { $max: '$lastSeenAt' },
        },
      },
      { $project: { _id: 0, scope: '$_id.scope', dataset: '$_id.dataset', scopeType: 1, scopeName: 1, count: 1, lastSeenAt: 1 } },
      { $sort: { lastSeenAt: -1 } },
    ]);
  }

  private filter(scope: string, dataset: string, q?: string) {
    return {
      scope,
      dataset,
      ...(q?.trim() ? { text: { $regex: escapeRegex(q.trim().toLowerCase()) } } : {}),
    };
  }

  async list(scope: string, dataset: string, opts: { q?: string; page: number; limit: number }) {
    const filter = this.filter(scope, dataset, opts.q);
    const [items, total, sample] = await Promise.all([
      this.records
        .find(filter, { text: 0 })
        .sort({ lastSeenAt: -1, _id: 1 })
        .skip((opts.page - 1) * opts.limit)
        .limit(opts.limit)
        .lean(),
      this.records.countDocuments(filter),
      this.records.find({ scope, dataset }, { data: 1 }).sort({ lastSeenAt: -1 }).limit(COLUMN_SAMPLE).lean(),
    ]);
    const page: Page<(typeof items)[number]> = { items, total, page: opts.page, limit: opts.limit };
    return { ...page, columns: columnsOf(sample.map((r) => r.data)) };
  }

  /** Whole dataset (search applied) as CSV or JSON. */
  async export(scope: string, dataset: string, format: 'csv' | 'json', q?: string) {
    const rows = await this.records.find(this.filter(scope, dataset, q), { data: 1, scopeName: 1 }).sort({ lastSeenAt: -1 }).lean();
    if (!rows.length) throw new NotFoundException('Không có dữ liệu');
    const data = rows.map((r) => r.data);
    const name = `${rows[0].scopeName || scope}-${dataset}`.replace(/[\\/:*?"<>|]+/g, '_');
    return format === 'json'
      ? { name: `${name}.json`, mime: 'application/json', body: JSON.stringify(data, null, 2) }
      : { name: `${name}.csv`, mime: 'text/csv; charset=utf-8', body: toCsv(columnsOf(data), data) };
  }

  async removeDataset(scope: string, dataset: string) {
    const res = await this.records.deleteMany({ scope, dataset });
    return { deleted: res.deletedCount };
  }

  async removeRecord(id: string) {
    const res = await this.records.deleteOne({ _id: id });
    if (!res.deletedCount) throw new NotFoundException('Không tìm thấy bản ghi');
  }
}
