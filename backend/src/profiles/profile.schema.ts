import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import type { Emulation } from '../browser/emulation.js';

/**
 * A persistent Chrome profile (its own user data dir under PROFILES_DIR/<id>),
 * keeps cookies / logins between jobs. One task at a time per profile.
 */
@Schema({ collection: 'profiles', timestamps: true })
export class Profile {
  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, default: '' })
  notes: string;

  @Prop({ type: String })
  userDataDir: string;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  emulation: Emulation;

  @Prop({ type: SchemaTypes.Mixed })
  proxy?: Emulation['proxy'];

  @Prop({ type: Date })
  lastUsedAt?: Date;
}

export type ProfileDocument = HydratedDocument<Profile>;
export const ProfileSchema = SchemaFactory.createForClass(Profile);
