import { IsArray, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import type { Action } from '../actions/action.types.js';
import type { Emulation } from '../browser/emulation.js';

export class ScriptDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Shape is checked against the action JSON Schema in the service. */
  @IsArray()
  actions: Action[];

  @IsOptional()
  @IsObject()
  defaultVars?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  emulation?: Emulation;
}
