import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

/** One version of a publisher selector; the newest per key is the one in use. */
@Schema({ collection: 'selector_versions', timestamps: { createdAt: true, updatedAt: false } })
export class SelectorVersion {
  @Prop({ type: String, required: true, index: true })
  key: string;

  @Prop({ type: String, required: true })
  value: string;

  /** Value it replaced. */
  @Prop({ type: String, default: '' })
  previous: string;

  /** ai: fixed automatically or on request; user: edited / reverted by hand. */
  @Prop({ type: String, required: true })
  source: 'ai' | 'user';

  @Prop({ type: String, default: '' })
  reason: string;

  /** The error that triggered an AI fix. */
  @Prop({ type: String })
  error?: string;

  @Prop({ type: String })
  model?: string;

  /** Task whose failure triggered the fix. */
  @Prop({ type: SchemaTypes.ObjectId })
  taskId?: Types.ObjectId;

  /** Checked on the live page before being saved. */
  @Prop({ type: Boolean, default: false })
  validated: boolean;

  createdAt?: Date;
}

export type SelectorVersionDocument = HydratedDocument<SelectorVersion>;
export const SelectorVersionSchema = SchemaFactory.createForClass(SelectorVersion);
SelectorVersionSchema.index({ key: 1, createdAt: -1 });
