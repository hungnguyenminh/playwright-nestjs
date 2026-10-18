import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import type { SourceSpec } from '../sources/connectors.js';

export type FlowKind = 'script' | 'sources';

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
}

export type FlowDocument = HydratedDocument<Flow>;
export const FlowSchema = SchemaFactory.createForClass(Flow);
FlowSchema.index({ updatedAt: -1 });
