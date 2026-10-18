import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Emulation } from '../browser/emulation.js';
import type { ProfileMode } from './profile.schema.js';

export class ProfileDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  emulation?: Emulation;

  @IsOptional()
  @IsObject()
  proxy?: Emulation['proxy'];

  /** folder = Chrome user-data dir (default); session = encrypted cookies in the database. */
  @IsOptional()
  @IsIn(['folder', 'session'])
  mode?: ProfileMode;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  loginUrl?: string;
}
