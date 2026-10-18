import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import type { Action } from '../actions/action.types.js';
import type { StepStatus } from '../actions/run-context.js';
import type { Emulation } from '../browser/emulation.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'done'
  | 'failed'
  | 'cancelled';

export const FINISHED: readonly TaskStatus[] = ['done', 'failed', 'cancelled'];

export type Totals = Record<TaskStatus, number>;
export const emptyTotals = (): Totals => ({
  queued: 0,
  running: 0,
  paused: 0,
  done: 0,
  failed: 0,
  cancelled: 0,
});

@Schema({ collection: 'jobs', timestamps: true })
export class Job {
  @Prop({ type: String, default: '' })
  name: string;

  @Prop({ type: SchemaTypes.ObjectId, index: true })
  scriptId?: Types.ObjectId;

  /** Set when the job was started from a saved flow (Luồng). */
  @Prop({ type: SchemaTypes.ObjectId, index: true })
  flowId?: Types.ObjectId;

  /** Jobs started together by one run of a multi-source flow share this id. */
  @Prop({ type: SchemaTypes.ObjectId, index: true })
  runId?: Types.ObjectId;

  /** Data source the job reads (website, youtube…), for source flows. */
  @Prop({ type: String })
  source?: string;

  /** Snapshot of the script at creation, so later edits don't affect the job. */
  @Prop({ type: SchemaTypes.Mixed, required: true })
  actions: Action[];

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  emulation: Emulation;

  @Prop({ type: SchemaTypes.ObjectId })
  profileId?: Types.ObjectId;

  @Prop({ type: String, default: 'queued', index: true })
  status: JobStatus;

  @Prop({ type: Number, default: 3 })
  concurrency: number;

  @Prop({ type: Boolean, default: true })
  headless: boolean;

  /** Automatic re-runs of a failed task (fresh browser context each time). */
  @Prop({ type: Number, default: 0 })
  maxRetries: number;

  @Prop({ type: Number, default: 30_000 })
  stepTimeout: number;

  @Prop({ type: SchemaTypes.Mixed, default: emptyTotals })
  totals: Totals;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  finishedAt?: Date;
}

@Schema({ collection: 'tasks', timestamps: true })
export class Task {
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  jobId: Types.ObjectId;

  /** Position in the job's inputs. */
  @Prop({ type: Number, required: true })
  index: number;

  @Prop({ type: String, default: '' })
  name: string;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  vars: Record<string, unknown>;

  @Prop({ type: String, default: 'queued' })
  status: TaskStatus;

  @Prop({ type: Number, default: 0 })
  attempt: number;

  @Prop({ type: String })
  currentUrl?: string;

  /** Path of the step running now, e.g. "3.actions.2". */
  @Prop({ type: String })
  currentStep?: string;

  @Prop({ type: String })
  pauseMessage?: string;

  @Prop({ type: SchemaTypes.Mixed })
  error?: { stepPath?: string; actionType?: string; message: string; screenshot?: string };

  @Prop({ type: SchemaTypes.Mixed })
  result?: Record<string, unknown>;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  finishedAt?: Date;
}

/** Days step logs are kept before MongoDB's TTL monitor removes them. */
export const TASK_LOG_TTL_DAYS = 30;

@Schema({ collection: 'task_logs', versionKey: false })
export class TaskLog {
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  taskId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  jobId: Types.ObjectId;

  @Prop({ type: Number, default: 1 })
  attempt: number;

  @Prop({ type: String, required: true })
  path: string;

  @Prop({ type: String, required: true })
  type: string;

  @Prop({ type: String })
  label?: string;

  @Prop({ type: String, required: true })
  status: StepStatus;

  @Prop({ type: Number, default: 0 })
  durationMs: number;

  @Prop({ type: String })
  message?: string;

  @Prop({ type: Date, default: () => new Date() })
  ts: Date;
}

export type JobDocument = HydratedDocument<Job>;
export type TaskDocument = HydratedDocument<Task>;

export const JobSchema = SchemaFactory.createForClass(Job);
JobSchema.index({ createdAt: -1 });

export const TaskSchema = SchemaFactory.createForClass(Task);
TaskSchema.index({ jobId: 1, index: 1 });
TaskSchema.index({ jobId: 1, status: 1 });

export const TaskLogSchema = SchemaFactory.createForClass(TaskLog);
TaskLogSchema.index({ taskId: 1, ts: 1 });
TaskLogSchema.index({ ts: 1 }, { expireAfterSeconds: TASK_LOG_TTL_DAYS * 86_400 });
