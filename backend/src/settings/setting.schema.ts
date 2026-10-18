import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';

/** Key/value app settings, e.g. `{ key: 'ai', value: {...} }`. */
@Schema({ collection: 'settings', timestamps: true })
export class Setting {
  @Prop({ type: String, required: true, unique: true })
  key: string;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  value: Record<string, unknown>;
}

export const SettingSchema = SchemaFactory.createForClass(Setting);
