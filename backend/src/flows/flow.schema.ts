import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import type { SourceSpec } from '../sources/connectors.js';

export type FlowKind = 'script' | 'sources' | 'pipeline';

/** Runs the flow by itself every N hours / days (a late run runs once, then the cycle continues). */
export interface AutoRun {
  enabled: boolean;
  every: number;
  unit: 'hour' | 'day';
  activeHours?: { from: string; to: string };
  nextRunAt?: Date;
}

/** Crawl → publish: how new rows become posts. */
export interface GenerateSpec {
  mode: 'perRecord' | 'digest';
  digestSize?: number;
  /** User's instructions to the AI, e.g. "viết review ngắn, giọng vui". */
  prompt: string;
  tone?: string;
  length?: 'short' | 'medium' | 'long';
  language?: string;
  platforms: Array<'facebook' | 'youtube' | 'tiktok' | 'threads'>;
  /** New rows turned into posts per run (default 5). */
  maxPostsPerRun: number;
  filter?: { datasets?: string[]; q?: string; requireImage?: boolean };
  /** Download the row's image and attach it. */
  attachImage: boolean;
  /** review: posts wait as drafts; auto: ready and published by the schedule. */
  approval: 'review' | 'auto';
}

/**
 * A saved "Luồng": which profile (optional), which script, and how to run it
 * (inputs and job settings), so the same thing can be run again with one click
 * and its runs followed in one place.
 */
@Schema({ collection: 'flows', timestamps: true })
export class Flow {
  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, default: '' })
  description: string;

  /** 'script': one script run over inputs. 'sources': built-in readers for websites / platforms. */
  @Prop({ type: String, default: 'script' })
  kind: FlowKind;

  @Prop({ type: SchemaTypes.ObjectId })
  profileId?: Types.ObjectId;

  /** Script flows only. */
  @Prop({ type: SchemaTypes.ObjectId })
  scriptId?: Types.ObjectId;

  /** Source flows only: one job per source on each run. */
  @Prop({ type: SchemaTypes.Mixed, default: [] })
  sources: SourceSpec[];

  /** Task inputs as typed in the wizard: CSV with a header row, or JSON. */
  @Prop({ type: String, default: '' })
  inputsText: string;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  vars: Record<string, unknown>;

  @Prop({ type: Number, default: 3 })
  concurrency: number;

  @Prop({ type: Boolean, default: true })
  headless: boolean;

  @Prop({ type: Number, default: 0 })
  maxRetries: number;

  /** Seconds. */
  @Prop({ type: Number, default: 30 })
  stepTimeout: number;

  @Prop({ type: Number, default: 0 })
  runs: number;

  @Prop({ type: Date })
  lastRunAt?: Date;

  @Prop({ type: SchemaTypes.ObjectId })
  lastJobId?: Types.ObjectId;

  /** Source flows: the run (group of jobs) started last. */
  @Prop({ type: SchemaTypes.ObjectId })
  lastRunId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.Mixed })
  autoRun?: AutoRun;

  /** Pipeline flows. */
  @Prop({ type: SchemaTypes.Mixed })
  generate?: GenerateSpec;

  /** Pipeline flows: the publishing campaign that takes this flow's posts. */
  @Prop({ type: SchemaTypes.ObjectId })
  campaignId?: Types.ObjectId;
}

export type FlowRunStatus = 'crawling' | 'generating' | 'done' | 'failed';

/** One run of a source / pipeline flow: its crawl jobs, new rows, posts written. */
@Schema({ collection: 'flow_runs', timestamps: true })
export class FlowRun {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  flowId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, required: true, unique: true })
  runId: Types.ObjectId;

  @Prop({ type: String, default: 'crawling', index: true })
  status: FlowRunStatus;

  /** 'manual' (button / API) or 'auto' (autoRun). */
  @Prop({ type: String, default: 'manual' })
  trigger: 'manual' | 'auto';

  @Prop({ type: Number, default: 0 })
  jobs: number;

  @Prop({ type: Number, default: 0 })
  newRecords: number;

  @Prop({ type: Number, default: 0 })
  postsCreated: number;

  @Prop({ type: Number, default: 0 })
  skipped: number;

  @Prop({ type: String })
  error?: string;

  @Prop({ type: Date, required: true })
  startedAt: Date;

  @Prop({ type: Date })
  finishedAt?: Date;

  /** Its activity line was written. */
  @Prop({ type: Boolean })
  logged?: boolean;
}
export const FlowRunSchema = SchemaFactory.createForClass(FlowRun);

export type FlowDocument = HydratedDocument<Flow>;
export const FlowSchema = SchemaFactory.createForClass(Flow);
FlowSchema.index({ updatedAt: -1 });
