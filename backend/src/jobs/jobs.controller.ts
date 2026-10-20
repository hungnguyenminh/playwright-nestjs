import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { PageQuery } from '../common/pagination.js';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe.js';
import { CreateJobDto, JobQuery } from './job.dto.js';
import { JobsService } from './jobs.service.js';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  create(@Body() dto: CreateJobDto) {
    return this.jobs.create(dto);
  }

  @Get()
  list(@Query() q: JobQuery) {
    return this.jobs.list(q);
  }

  @Get(':id')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.jobs.get(id);
  }

  @Get(':id/tasks')
  tasks(@Param('id', ParseObjectIdPipe) id: string, @Query() q: PageQuery) {
    return this.jobs.listTasks(id, q);
  }

  @Post(':id/cancel')
  @HttpCode(202)
  cancel(@Param('id', ParseObjectIdPipe) id: string) {
    return this.jobs.cancel(id);
  }

  @Post(':id/retry')
  retry(@Param('id', ParseObjectIdPipe) id: string, @Body() body: { useLatestScript?: boolean } = {}) {
    return this.jobs.retry(id, body?.useLatestScript === true);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.jobs.remove(id);
  }
}

@Controller('tasks')
export class TasksController {
  constructor(private readonly jobs: JobsService) {}

  @Get(':id')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.jobs.getTask(id);
  }

  @Get(':id/logs')
  logs(@Param('id', ParseObjectIdPipe) id: string) {
    return this.jobs.taskLogs(id);
  }

  @Get(':id/artifacts')
  artifacts(@Param('id', ParseObjectIdPipe) id: string) {
    return this.jobs.taskArtifacts(id);
  }

  @Post(':id/cancel')
  @HttpCode(202)
  cancel(@Param('id', ParseObjectIdPipe) id: string) {
    return this.jobs.cancelTask(id);
  }

  /** Pauses before the next step, e.g. to take over mouse/keyboard. */
  @Post(':id/pause')
  @HttpCode(202)
  pause(@Param('id', ParseObjectIdPipe) id: string) {
    return this.jobs.pauseTask(id);
  }

  @Post(':id/resume')
  @HttpCode(202)
  resume(@Param('id', ParseObjectIdPipe) id: string) {
    return this.jobs.resumeTask(id);
  }
}
