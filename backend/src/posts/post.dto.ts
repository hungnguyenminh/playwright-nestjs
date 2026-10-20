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
} from 'class-validator';
import { PLATFORMS, type Platform } from '../publish/platforms.js';
import { POST_STATUSES, type PostStatus } from './post.schema.js';

export class PostDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  hashtags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  mediaIds?: string[];

  @IsOptional()
  @IsString()
  link?: string;

  /** { facebook: { format, content, … }, youtube: {…} }: keys = target platforms. */
  @IsOptional()
  @IsObject()
  platforms?: Record<string, Record<string, unknown>>;

  @IsOptional()
  @IsIn(POST_STATUSES)
  status?: PostStatus;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class PostQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 20;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsMongoId()
  flowId?: string;

  @IsOptional()
  @IsString()
  q?: string;
}

export class CheckPostDto {
  @IsObject()
  post: PostDto;

  /** Default: the platforms the post targets. */
  @IsOptional()
  @IsArray()
  @IsIn(PLATFORMS, { each: true })
  platforms?: Platform[];
}

export class BulkStatusDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsMongoId({ each: true })
  ids: string[];

  @IsIn(POST_STATUSES)
  status: PostStatus;
}

export class GeneratePostsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  recordIds: string[];

  @IsArray()
  @IsIn(PLATFORMS, { each: true })
  platforms: Platform[];

  @IsOptional()
  @IsIn(['perRecord', 'digest'])
  mode: 'perRecord' | 'digest' = 'perRecord';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(20)
  digestSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tone?: string;

  @IsOptional()
  @IsIn(['short', 'medium', 'long'])
  length?: 'short' | 'medium' | 'long';

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsBoolean()
  attachImage?: boolean;

  @IsOptional()
  @IsIn(['review', 'auto'])
  approval?: 'review' | 'auto';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
