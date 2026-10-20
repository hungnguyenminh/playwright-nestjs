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

export class AutoRunDto {
  @IsBoolean()
  enabled: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  every: number;

  @IsIn(['hour', 'day'])
  unit: 'hour' | 'day';

  @IsOptional()
  @IsObject()
  activeHours?: { from: string; to: string };
}

export class GenerateSpecDto {
  @IsIn(['perRecord', 'digest'])
  mode: 'perRecord' | 'digest';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(20)
  digestSize?: number;

  @IsString()
  @MaxLength(4000)
  prompt: string;

  @IsOptional()
  @IsString()
  tone?: string;

  @IsOptional()
  @IsIn(['short', 'medium', 'long'])
  length?: 'short' | 'medium' | 'long';

  @IsOptional()
  @IsString()
  language?: string;

  @IsArray()
  @IsIn(['facebook', 'youtube', 'tiktok', 'threads'], { each: true })
  platforms: Array<'facebook' | 'youtube' | 'tiktok' | 'threads'>;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  maxPostsPerRun: number;

  @IsOptional()
  @IsObject()
  filter?: { datasets?: string[]; q?: string; requireImage?: boolean };

  @IsBoolean()
  attachImage: boolean;

  @IsIn(['review', 'auto'])
  approval: 'review' | 'auto';
}

export class FlowDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['script', 'sources', 'pipeline'])
  kind?: 'script' | 'sources' | 'pipeline';

  /** '' or omitted = no profile (fresh browser for every task). */
  @IsOptional()
  @IsString()
  profileId?: string;

  /** Required for script flows. */
  @ValidateIf((o: FlowDto) => !o.kind || o.kind === 'script')
  @IsMongoId()
  scriptId?: string;

  /** Required for source and pipeline flows. */
  @ValidateIf((o: FlowDto) => o.kind === 'sources' || o.kind === 'pipeline')
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

  /** Run by itself every N hours / days (any kind). */
  @IsOptional()
  @ValidateNested()
  @Type(() => AutoRunDto)
  autoRun?: AutoRunDto;

  /** Pipeline flows: how the AI writes posts from new rows. */
  @ValidateIf((o: FlowDto) => o.kind === 'pipeline')
  @ValidateNested()
  @Type(() => GenerateSpecDto)
  generate?: GenerateSpecDto;

  /**
   * Pipeline flows: the publishing part, like a campaign without its posts
   * (destinations, schedule, staggerMinutes, minGapMinutes, catchUp, headless, dryRun).
   */
  @ValidateIf((o: FlowDto) => o.kind === 'pipeline')
  @IsObject()
  campaign?: Record<string, unknown>;
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
