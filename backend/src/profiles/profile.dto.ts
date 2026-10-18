import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import type { Emulation } from '../browser/emulation.js';

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
}
