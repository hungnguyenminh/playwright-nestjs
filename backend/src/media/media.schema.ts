import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MediaKind = 'image' | 'video';

/** An image or video attached to posts; the file lives in STORAGE_DIR/media/. */
@Schema({ collection: 'media', timestamps: true })
export class Media {
  /** Original file name. */
  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, required: true })
  mime: string;

  @Prop({ type: String, required: true })
  kind: MediaKind;

  @Prop({ type: Number, required: true })
  size: number;

  @Prop({ type: Number })
  width?: number;

  @Prop({ type: Number })
  height?: number;

  /** Seconds (videos). */
  @Prop({ type: Number })
  duration?: number;

  /** Absolute path on disk (never sent to clients). */
  @Prop({ type: String, required: true, select: false })
  path: string;

  /** Where it was downloaded from (POST /media/from-url). */
  @Prop({ type: String })
  sourceUrl?: string;
}

export type MediaDocument = HydratedDocument<Media>;
export const MediaSchema = SchemaFactory.createForClass(Media);
MediaSchema.index({ createdAt: -1 });
