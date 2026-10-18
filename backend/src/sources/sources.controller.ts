import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { SourceDto } from '../flows/flow.dto.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { buildSourceJob, checkSource, DEFAULT_LIMIT, MAX_LIMIT, SOURCE_INFO, SOURCE_TYPES } from './connectors.js';

/** Items read by a test run: enough to see that it works, quick to finish. */
const TEST_LIMIT = 5;

class TestSourceDto extends SourceDto {
  /** Show the Chrome window (default: headless, live view still works). */
  @IsOptional()
  @IsBoolean()
  headless?: boolean;
}

@Controller('sources')
export class SourcesController {
  constructor(
    private readonly jobs: JobsService,
    private readonly profiles: ProfilesService,
  ) {}

  @Get()
  list() {
    return { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT, sources: SOURCE_TYPES.map((t) => SOURCE_INFO[t]) };
  }

  /** The job a source would start: actions and one task per link / keyword. */
  @Post('preview')
  preview(@Body() dto: SourceDto) {
    const errors = checkSource(dto);
    return { errors, job: errors.length ? null : buildSourceJob(dto) };
  }

  /** Runs the source on its first link / keyword with a few items, as a standalone job. */
  @Post('test')
  async test(@Body() dto: TestSourceDto) {
    const errors = checkSource(dto);
    if (errors.length) throw new BadRequestException(errors.join('; '));
    if (dto.profileId) await this.profiles.get(dto.profileId);
    const built = buildSourceJob({ ...dto, limit: Math.min(dto.limit ?? TEST_LIMIT, TEST_LIMIT), detail: false });
    return this.jobs.create({
      name: `Thử nguồn · ${built.name} · ${String(built.inputs[0]?.name ?? '')}`,
      source: dto.type,
      actions: built.actions,
      inputs: built.inputs.slice(0, 1),
      vars: built.vars,
      profileId: dto.profileId || undefined,
      headless: dto.headless ?? true,
      concurrency: 1,
    });
  }
}
