import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import type { ArtifactKind } from '../actions/run-context.js';

@Schema({ collection: 'artifacts', timestamps: { createdAt: true, updatedAt: false } })
export class Artifact {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  taskId: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  jobId: Types.ObjectId;

  @Prop({ type: String, required: true })
  kind: ArtifactKind;

  @Prop({ type: String, required: true })
  name: string;

  /** Absolute path on disk, under STORAGE_DIR. */
  @Prop({ type: String, required: true })
  path: string;

  @Prop({ type: Number, required: true })
  size: number;

  @Prop({ type: String, required: true })
  mime: string;
}

export type ArtifactDocument = HydratedDocument<Artifact>;
export const ArtifactSchema = SchemaFactory.createForClass(Artifact);
