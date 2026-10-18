import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_LIMIT, SOURCE_TYPES, type SourceType } from '../sources/connectors.js';

export class SourceDto {
  @IsIn(SOURCE_TYPES)
  type: SourceType;

  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  targets: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  keywords?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @IsBoolean()
  detail?: boolean;

  /** '' or omitted = fresh browser. */
  @IsOptional()
  @IsString()
  profileId?: string;
}

export class FlowDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['script', 'sources'])
  kind?: 'script' | 'sources';

  /** '' or omitted = no profile (fresh browser for every task). */
  @IsOptional()
  @IsString()
  profileId?: string;

  /** Required for script flows. */
  @ValidateIf((o: FlowDto) => o.kind !== 'sources')
  @IsMongoId()
  scriptId?: string;

  /** Required for source flows. */
  @ValidateIf((o: FlowDto) => o.kind === 'sources')
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SourceDto)
  sources?: SourceDto[];

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
