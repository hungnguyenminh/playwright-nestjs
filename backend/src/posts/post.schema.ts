import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import type { Platform, PlatformPostOptions } from '../publish/platforms.js';

export type PostStatus = 'draft' | 'ready' | 'archived';
export const POST_STATUSES: PostStatus[] = ['draft', 'ready', 'archived'];

/**
 * A post to publish: shared content + media, and per platform a format and
 * options (a platform key being present = the post targets that platform).
 * Only 'ready' posts are picked by schedules.
 */
// minimize: false keeps `platforms.facebook = {}` (a target platform with default options).
@Schema({ collection: 'posts', timestamps: true, minimize: false })
export class Post {
  /** Internal name. */
  @Prop({ type: String, required: true, trim: true })
  title: string;

  @Prop({ type: String, default: '' })
  content: string;

  @Prop({ type: [String], default: [] })
  hashtags: string[];

  @Prop({ type: [SchemaTypes.ObjectId], default: [] })
  mediaIds: Types.ObjectId[];

  @Prop({ type: String })
  link?: string;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  platforms: Partial<Record<Platform, PlatformPostOptions>>;

  @Prop({ type: String, default: 'draft', index: true })
  status: PostStatus;

  /** Free labels for filtering. */
  @Prop({ type: [String], default: [], index: true })
  tags: string[];

  @Prop({ type: String, default: 'manual' })
  origin: 'manual' | 'ai';

  /** Set when a crawl → publish flow made the post. */
  @Prop({ type: SchemaTypes.ObjectId, index: true })
  flowId?: Types.ObjectId;

  /** Data rows the post was written from (to never write two posts from one row). */
  @Prop({ type: [{ recordId: SchemaTypes.ObjectId, scope: String, dataset: String, _id: false }], default: [] })
  sourceRecords: Array<{ recordId: Types.ObjectId; scope: string; dataset: string }>;

  @Prop({ type: Number, default: 0 })
  usedCount: number;

  @Prop({ type: Date })
  lastPublishedAt?: Date;
}

export type PostDocument = HydratedDocument<Post>;
export const PostSchema = SchemaFactory.createForClass(Post);
PostSchema.index({ updatedAt: -1 });
PostSchema.index({ 'sourceRecords.recordId': 1 });
