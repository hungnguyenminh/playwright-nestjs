import {
  IsArray,
  IsBoolean,
  IsInt,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import type { Action } from '../actions/action.types.js';
import type { Emulation } from '../browser/emulation.js';

export class CreateJobDto {
  @IsOptional()
  @IsString()
  name?: string;

  /** Either a saved script... */
  @IsOptional()
  @IsMongoId()
  scriptId?: string;

  /** The flow (Luồng) this run belongs to. */
  @IsOptional()
  @IsMongoId()
  flowId?: string;

  /** Run of a multi-source flow this job belongs to. */
  @IsOptional()
  @IsMongoId()
  runId?: string;

  @IsOptional()
  @IsString()
  source?: string;

  /** ...or inline actions (wins over the script's actions if both are given). */
  @IsOptional()
  @IsArray()
  actions?: Action[];

  /** One task per input object; its keys become variables. `name` labels the task. */
  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  inputs?: Record<string, unknown>[];

  /** Variables shared by every task (under the inputs, over script defaults). */
  @IsOptional()
  @IsObject()
  vars?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  concurrency?: number;

  @IsOptional()
  @IsBoolean()
  headless?: boolean;

  @IsOptional()
  @IsMongoId()
  profileId?: string;

  @IsOptional()
  @IsObject()
  emulation?: Emulation;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  maxRetries?: number;

  @IsOptional()
  @IsInt()
  @Min(1_000)
  @Max(600_000)
  stepTimeout?: number;
}
