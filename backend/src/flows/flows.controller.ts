import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { PageQuery } from '../common/pagination.js';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe.js';
import { FlowDto, RunFlowDto } from './flow.dto.js';
import { FlowsService } from './flows.service.js';

@Controller('flows')
export class FlowsController {
  constructor(private readonly flows: FlowsService) {}

  @Get()
  list() {
    return this.flows.list();
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

  @Get(':id/jobs')
  jobs(@Param('id', ParseObjectIdPipe) id: string, @Query() q: PageQuery) {
    return this.flows.listJobs(id, q);
  }
}
