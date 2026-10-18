import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import type { Action } from '../actions/action.types.js';
import type { Emulation } from '../browser/emulation.js';

@Schema({ collection: 'scripts', timestamps: true })
export class Script {
  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, default: '' })
  description: string;

  @Prop({ type: SchemaTypes.Mixed, default: [] })
  actions: Action[];

  /** Variables every task starts with; job inputs override them. */
  @Prop({ type: SchemaTypes.Mixed, default: {} })
  defaultVars: Record<string, unknown>;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  emulation: Emulation;
}

export type ScriptDocument = HydratedDocument<Script>;
export const ScriptSchema = SchemaFactory.createForClass(Script);
