import { Controller, Get, Param, Query, StreamableFile } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe.js';
import { ArtifactsService } from './artifacts.service.js';

@Controller('artifacts')
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  /** Inline by default (images/PDF preview in the browser); `?download=1` to save. */
  @Get(':id')
  async file(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query('download') download?: string,
  ) {
    const a = await this.artifacts.get(id);
    return new StreamableFile(createReadStream(a.path), {
      type: a.mime,
      length: a.size,
      disposition: `${download ? 'attachment' : 'inline'}; filename="${a.name}"`,
    });
  }
}
