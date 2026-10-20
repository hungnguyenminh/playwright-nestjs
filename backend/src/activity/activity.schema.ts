import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

/** Who did it: a person through the UI / API, the app on its own (schedulers, runners), or the AI. */
export type ActivityActor = 'user' | 'system' | 'ai';
export type ActivityLevel = 'info' | 'warn' | 'error';

/** Days activity entries are kept (ACTIVITY_TTL_DAYS). */
export const ACTIVITY_TTL_DAYS = Math.max(1, Number(process.env.ACTIVITY_TTL_DAYS) || 180);

/** One thing that happened in the system, for the "Nhật ký hoạt động" page. */
@Schema({ collection: 'activity_logs', versionKey: false })
export class Activity {
  @Prop({ type: Date, required: true, default: () => new Date() })
  at: Date;

  @Prop({ type: String, required: true, index: true })
  actor: ActivityActor;

  @Prop({ type: String, default: 'info', index: true })
  level: ActivityLevel;

  /** Area: crawl, publish, pipeline, post, campaign, profile, script, flow, job, data, settings, ai, selector, system… */
  @Prop({ type: String, required: true, index: true })
  category: string;

  /** Machine name, e.g. "flow.create", "job.finish", "selector.fix". */
  @Prop({ type: String, required: true, index: true })
  action: string;

  /** One line in Vietnamese. */
  @Prop({ type: String, required: true })
  summary: string;

  /** { type, id, name } — Mixed: a nested "type" key would be read by mongoose as a type declaration. */
  @Prop({ type: SchemaTypes.Mixed })
  target?: { type: string; id?: string; name?: string };

  /** Request body (secrets removed), before / after values, error… */
  @Prop({ type: SchemaTypes.Mixed })
  details?: Record<string, unknown>;

  /** Lower-cased text for search. */
  @Prop({ type: String, default: '' })
  text: string;
}

export type ActivityDocument = HydratedDocument<Activity>;
export const ActivitySchema = SchemaFactory.createForClass(Activity);
ActivitySchema.index({ at: -1 });
ActivitySchema.index({ at: 1 }, { expireAfterSeconds: ACTIVITY_TTL_DAYS * 86_400 });
