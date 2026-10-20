import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PLATFORMS, type Platform } from './platforms.js';

export class LimitsDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_080)
  minGapPerProfileMinutes: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxPerProfilePerDay: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  noRepeatPostDays: number;
}

export class RotateDto {
  @IsIn(['roundRobin', 'random', 'leastRecent'])
  strategy: 'roundRobin' | 'random' | 'leastRecent';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  startOffset?: number;
}

export class DestinationDto {
  @IsIn(PLATFORMS)
  platform: Platform;

  @IsIn(['self', 'page', 'group'])
  kind: 'self' | 'page' | 'group';

  @IsOptional()
  @IsString()
  url?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  profileIds: string[];

  @IsIn(['all', 'rotate'])
  accountMode: 'all' | 'rotate';

  @IsOptional()
  @ValidateNested()
  @Type(() => RotateDto)
  rotate?: RotateDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LimitsDto)
  limits?: LimitsDto;
}

export class CampaignDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DestinationDto)
  destinations: DestinationDto[];

  /** { type: 'list', postIds, separate? } or { type: 'flow', flowId }. */
  @IsObject()
  postSource: { type: 'list'; postIds: string[]; separate?: Record<string, string[]> } | { type: 'flow'; flowId: string };

  @IsOptional()
  @IsIn(['sequential', 'random'])
  order?: 'sequential' | 'random';

  @IsOptional()
  @IsIn(['stop', 'loop', 'wait'])
  whenExhausted?: 'stop' | 'loop' | 'wait';

  @IsOptional()
  @IsIn(['same', 'rotate', 'separate'])
  assignment?: 'same' | 'rotate' | 'separate';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  staggerMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1440)
  minGapMinutes?: number;

  /** { mode: 'once', at? } | { mode: 'slots', slots[] } | { mode: 'interval', startAt, every, unit, count?, jitterMinutes?, activeHours? } */
  @IsObject()
  schedule: Record<string, unknown>;

  @IsOptional()
  @IsIn(['shift', 'skip'])
  catchUp?: 'shift' | 'skip';

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  headless?: boolean;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsMongoId()
  flowId?: string;
}

export class PublicationQuery {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  destIndex?: number;

  @IsOptional()
  @IsMongoId()
  profileId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit = 100;
}

export class UpcomingQuery {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsIn(PLATFORMS)
  platform?: Platform;

  @IsOptional()
  @IsMongoId()
  profileId?: string;
}

export class UpdatePublicationDto {
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsMongoId()
  postId?: string;
}

export class PublishTargetDto {
  @IsIn(PLATFORMS)
  platform: Platform;

  @IsIn(['self', 'page', 'group'])
  kind: 'self' | 'page' | 'group';

  @IsOptional()
  @IsString()
  url?: string;

  @IsMongoId()
  profileId: string;
}

export class PublishNowDto {
  @IsMongoId()
  postId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PublishTargetDto)
  targets: PublishTargetDto[];

  @IsOptional()
  @IsBoolean()
  headless?: boolean;
}

export class PublishTestDto {
  @IsMongoId()
  postId: string;

  @ValidateNested()
  @Type(() => PublishTargetDto)
  target: PublishTargetDto;

  @IsOptional()
  @IsBoolean()
  headless?: boolean;
}
