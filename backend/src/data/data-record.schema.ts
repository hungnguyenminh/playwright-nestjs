import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type ScopeType = 'flow' | 'script' | 'job';

/**
 * One collected item (a post, a product, a row of values). Lives on after
 * its job is deleted; the same item from later runs updates this row.
 */
@Schema({ collection: 'records', versionKey: false })
export class DataRecord {
  /** Where the data belongs: "flow:<id>", "script:<id>" or "job:<id>". */
  @Prop({ type: String, required: true })
  scope: string;

  @Prop({ type: String, required: true })
  scopeType: ScopeType;

  /** Flow / script / job name at the last update. */
  @Prop({ type: String, default: '' })
  scopeName: string;

  /** Result variable the rows came from (e.g. "posts"). */
  @Prop({ type: String, required: true })
  dataset: string;

  @Prop({ type: String, required: true })
  key: string;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  data: Record<string, unknown>;

  /** Lower-cased JSON for search. */
  @Prop({ type: String, default: '' })
  text: string;

  @Prop({ type: SchemaTypes.ObjectId })
  flowId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId })
  scriptId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId })
  jobId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId })
  taskId: Types.ObjectId;

  @Prop({ type: String, default: '' })
  taskName: string;

  @Prop({ type: Date, required: true })
  firstSeenAt: Date;

  @Prop({ type: Date, required: true })
  lastSeenAt: Date;

  /** How many runs returned this item. */
  @Prop({ type: Number, default: 1 })
  seenCount: number;
}

export type DataRecordDocument = HydratedDocument<DataRecord>;
export const DataRecordSchema = SchemaFactory.createForClass(DataRecord);
DataRecordSchema.index({ scope: 1, dataset: 1, key: 1 }, { unique: true });
DataRecordSchema.index({ scope: 1, dataset: 1, lastSeenAt: -1 });
