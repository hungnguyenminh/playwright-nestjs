import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class FlowDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** '' or omitted = no profile (fresh browser for every task). */
  @IsOptional()
  @IsString()
  profileId?: string;

  @IsMongoId()
  scriptId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  inputsText?: string;

  @IsOptional()
  @IsObject()
  vars?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  concurrency?: number;

  @IsOptional()
  @IsBoolean()
  headless?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  maxRetries?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  stepTimeout?: number;
}

/** Optional one-off changes for a single run. */
export class RunFlowDto {
  @IsOptional()
  @IsString()
  inputsText?: string;

  @IsOptional()
  @IsObject()
  vars?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  headless?: boolean;
}
