import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import type { Emulation } from '../browser/emulation.js';

export type ProfileMode = 'folder' | 'session';

/**
 * A logged-in identity reused across jobs, in one of two modes:
 * - folder: a real Chrome user-data dir under PROFILES_DIR/<id> (everything
 *   Chrome keeps: cookies, IndexedDB, cache…). One task at a time.
 * - session: cookies + localStorage (Playwright storage state) encrypted in
 *   Mongo and loaded into a fresh context per task, so tasks can run in
 *   parallel; updated after every task.
 */
@Schema({ collection: 'profiles', timestamps: true })
export class Profile {
  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, default: '' })
  notes: string;

  @Prop({ type: String })
  userDataDir: string;

  @Prop({ type: String, default: 'folder' })
  mode: ProfileMode;

  /** Session mode: encrypted JSON storage state. Never sent to the browser. */
  @Prop({ type: String })
  sessionSealed?: string;

  @Prop({ type: Number, default: 0 })
  sessionCookies: number;

  @Prop({ type: Date })
  sessionUpdatedAt?: Date;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  emulation: Emulation;

  @Prop({ type: SchemaTypes.Mixed })
  proxy?: Emulation['proxy'];

  @Prop({ type: Date })
  lastUsedAt?: Date;

  /** Page last used with "Mở để đăng nhập", offered again next time. */
  @Prop({ type: String, default: '' })
  loginUrl: string;

  /** Set by publishing when the site asked to log in again: left out of account rotation until cleared. */
  @Prop({ type: SchemaTypes.Mixed })
  health?: { needsLogin?: boolean; lastError?: string; checkedAt?: Date };
}

export type ProfileDocument = HydratedDocument<Profile>;
export const ProfileSchema = SchemaFactory.createForClass(Profile);
