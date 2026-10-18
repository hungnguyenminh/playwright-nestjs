import {
  IsArray,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { AI_KINDS, type AiKind } from './forms.js';

/** One earlier exchange of the same conversation (sent back by the UI). */
export interface AiTurn {
  prompt: string;
  guide: string;
  proposal?: Record<string, unknown>;
}

export class AiAssistDto {
  @IsIn(AI_KINDS as unknown as string[])
  kind: AiKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  prompt: string;

  @IsOptional()
  @IsArray()
  history?: AiTurn[];

  /** What the form currently contains, so the AI edits instead of starting over. */
  @IsOptional()
  @IsObject()
  currentForm?: Record<string, unknown>;

  /** Open this page first and give the AI its structure and a screenshot. */
  @IsOptional()
  @IsString()
  @Matches(/^https?:\/\//i, {
    message: 'snapshotUrl phải bắt đầu bằng http:// hoặc https://',
  })
  snapshotUrl?: string;

  /** Open the snapshot page with this (logged-in) profile. */
  @IsOptional()
  @IsMongoId()
  snapshotProfileId?: string;

  /** Diagnose and fix the script of this failed task. */
  @IsOptional()
  @IsMongoId()
  fixTaskId?: string;
}
