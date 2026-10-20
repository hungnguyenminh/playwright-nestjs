import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { PageQuery } from '../common/pagination.js';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe.js';
import { FlowDto, RunFlowDto } from './flow.dto.js';
import { FlowsService } from './flows.service.js';

class AutoRunToggleDto {
  @IsBoolean()
  enabled: boolean;
}

@Controller('flows')
export class FlowsController {
  constructor(private readonly flows: FlowsService) {}

  /** `?kind=sources,pipeline` filters by kind. */
  @Get()
  list(@Query('kind') kind?: string) {
    return this.flows.list(kind);
  }

  @Get(':id')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.flows.get(id);
  }

  @Post()
  create(@Body() dto: FlowDto) {
    return this.flows.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: FlowDto) {
    return this.flows.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.flows.remove(id);
  }

  @Post(':id/run')
  run(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: RunFlowDto) {
    return this.flows.run(id, dto);
  }

  @Post(':id/auto-run')
  @HttpCode(200)
  autoRun(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: AutoRunToggleDto) {
    return this.flows.setAutoRun(id, dto.enabled);
  }

  @Get(':id/jobs')
  jobs(@Param('id', ParseObjectIdPipe) id: string, @Query() q: PageQuery) {
    return this.flows.listJobs(id, q);
  }

  /** Runs of source / pipeline flows: jobs, new rows, posts written. */
  @Get(':id/runs')
  runs(@Param('id', ParseObjectIdPipe) id: string) {
    return this.flows.listRuns(id);
  }
}
