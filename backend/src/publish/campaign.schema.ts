import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import type { Assignment, DestinationSpec, PostSourceSpec, ScheduleSpec } from './plan.js';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'done' | 'cancelled';
export type PublicationStatus =
  | 'scheduled'
  | 'waiting'
  | 'running'
  | 'published'
  | 'pending_approval'
  | 'failed'
  | 'unknown'
  | 'skipped'
  | 'cancelled';
export const PUBLICATION_STATUSES: PublicationStatus[] = [
  'scheduled',
  'waiting',
  'running',
  'published',
  'pending_approval',
  'failed',
  'unknown',
  'skipped',
  'cancelled',
];
/** Statuses that still have to run. */
export const OPEN_STATUSES: PublicationStatus[] = ['scheduled', 'waiting', 'running'];

export interface DestinationInfo {
  name?: string;
  id?: string;
  requiresApproval?: boolean;
  checkedAt?: Date;
}

/** Where, with which accounts, which posts and when. See plan.ts for the rules. */
@Schema({ collection: 'publish_campaigns', timestamps: true, minimize: false })
export class PublishCampaign {
  @Prop({ type: String, required: true, trim: true })
  name: string;

  /** Campaign of a flow (publish / crawl → publish). */
  @Prop({ type: SchemaTypes.ObjectId, index: true })
  flowId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.Mixed, default: [] })
  destinations: Array<DestinationSpec & { info?: DestinationInfo }>;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  postSource: PostSourceSpec;

  @Prop({ type: String, default: 'sequential' })
  order: 'sequential' | 'random';

  @Prop({ type: String, default: 'stop' })
  whenExhausted: 'stop' | 'loop' | 'wait';

  @Prop({ type: String, default: 'same' })
  assignment: Assignment;

  /** Minutes between the accounts of one slot ('all' destinations). */
  @Prop({ type: Number, default: 60 })
  staggerMinutes: number;

  /** Minutes between two posts of one account, across every campaign. */
  @Prop({ type: Number, default: 60 })
  minGapMinutes: number;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  schedule: ScheduleSpec;

  /** 'shift': after downtime the late slot runs now and the rest moves with it; 'skip': late slots are dropped. */
  @Prop({ type: String, default: 'shift' })
  catchUp: 'shift' | 'skip';

  @Prop({ type: String, default: 'Asia/Ho_Chi_Minh' })
  timezone: string;

  @Prop({ type: String, default: 'draft', index: true })
  status: CampaignStatus;

  @Prop({ type: Boolean, default: true })
  headless: boolean;

  /** Stop right before "Post" on every publication (rehearsal). */
  @Prop({ type: Boolean, default: false })
  dryRun: boolean;

  /** Endless schedules: where generation continues. */
  @Prop({ type: SchemaTypes.Mixed })
  planCursor?: { nextSlot: number; nextBaseAt: Date } | null;

  /** Rotation position per destination. */
  @Prop({ type: [Number], default: [] })
  rotationCursors: number[];

  /** Notable events ("moved 230 minutes after downtime"…), newest last, capped. */
  @Prop({ type: [{ at: Date, message: String, _id: false }], default: [] })
  log: Array<{ at: Date; message: string }>;

  @Prop({ type: Date })
  activatedAt?: Date;
}

/** One post at one place by one account at one time, and how it went. */
@Schema({ collection: 'publications', timestamps: true })
export class Publication {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  campaignId: Types.ObjectId;

  @Prop({ type: Number, required: true })
  slot: number;

  @Prop({ type: Number, required: true })
  destIndex: number;

  /** 'rotate', or the profile id of an 'all' destination. */
  @Prop({ type: String, required: true })
  lane: string;

  @Prop({ type: Number, default: 0 })
  laneIndex: number;

  @Prop({ type: String, required: true })
  platform: string;

  @Prop({ type: String, required: true })
  kind: string;

  @Prop({ type: String })
  url?: string;

  /** Same place across campaigns (limits). Set when the account is chosen. */
  @Prop({ type: String, index: true })
  destKey?: string;

  /** Account that actually posts (chosen at run time). */
  @Prop({ type: SchemaTypes.ObjectId, index: true })
  profileId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId })
  plannedProfileId?: Types.ObjectId;

  @Prop({ type: [{ profileId: SchemaTypes.ObjectId, error: String, at: Date, _id: false }], default: [] })
  attempts: Array<{ profileId: Types.ObjectId; error?: string; at: Date }>;

  /** Pinned or chosen post. */
  @Prop({ type: SchemaTypes.ObjectId })
  postId?: Types.ObjectId;

  /** Post expected at planning time (display only). */
  @Prop({ type: SchemaTypes.ObjectId })
  plannedPostId?: Types.ObjectId;

  /** The post was pinned by the user (chosen-time slot or "change post"). */
  @Prop({ type: Boolean, default: false })
  pinned: boolean;

  @Prop({ type: Date, required: true, index: true })
  scheduledAt: Date;

  /** First planned time, to show "moved by X minutes". */
  @Prop({ type: Date, required: true })
  originalAt: Date;

  @Prop({ type: String, default: 'scheduled', index: true })
  status: PublicationStatus;

  /** Why it is waiting (no account available, no post…). */
  @Prop({ type: String })
  waitReason?: string;

  @Prop({ type: SchemaTypes.ObjectId })
  jobId?: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId })
  taskId?: Types.ObjectId;

  @Prop({ type: String })
  postUrl?: string;

  @Prop({ type: String })
  error?: string;

  @Prop({ type: Date })
  startedAt?: Date;

  @Prop({ type: Date })
  finishedAt?: Date;
}

export type PublishCampaignDocument = HydratedDocument<PublishCampaign>;
export const PublishCampaignSchema = SchemaFactory.createForClass(PublishCampaign);
export const PublicationSchema = SchemaFactory.createForClass(Publication);
PublicationSchema.index({ status: 1, scheduledAt: 1 });
PublicationSchema.index({ campaignId: 1, slot: 1, destIndex: 1, lane: 1 }, { unique: true });
PublicationSchema.index({ profileId: 1, finishedAt: -1 });
PublicationSchema.index({ taskId: 1 });
