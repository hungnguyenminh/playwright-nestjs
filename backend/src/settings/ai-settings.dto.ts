import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AI_EFFORTS, type AiAuthType, type AiEffort } from '../ai/ai-client.js';

export class AiSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** '' = default endpoint. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  baseUrl?: string;

  @IsOptional()
  @IsIn(['apiKey', 'bearer'])
  authType?: AiAuthType;

  /** Omitted = keep the saved token; '' = remove it. */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;

  @IsOptional()
  @IsIn(AI_EFFORTS as unknown as string[])
  effort?: AiEffort;
}
