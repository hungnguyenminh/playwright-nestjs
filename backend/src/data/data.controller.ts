import { Controller, Delete, Get, HttpCode, Param, Query, Res } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import { PageQuery } from '../common/pagination.js';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe.js';
import { DataService } from './data.service.js';

class DatasetQuery {
  @IsString()
  @IsNotEmpty()
  scope: string;

  @IsString()
  @IsNotEmpty()
  dataset: string;
}

class RecordsQuery extends PageQuery {
  @IsString()
  @IsNotEmpty()
  scope: string;

  @IsString()
  @IsNotEmpty()
  dataset: string;

  @IsOptional()
  @IsString()
  q?: string;
}

class ExportQuery extends DatasetQuery {
  @IsOptional()
  @IsIn(['csv', 'json'])
  format?: 'csv' | 'json';

  @IsOptional()
  @IsString()
  q?: string;
}

@Controller('data')
export class DataController {
  constructor(private readonly data: DataService) {}

  /** Every (flow/script, result variable) pair with its row count. */
  @Get('datasets')
  datasets() {
    return this.data.datasets();
  }

  @Get('records')
  records(@Query() q: RecordsQuery) {
    return this.data.list(q.scope, q.dataset, { q: q.q, page: q.page, limit: q.limit });
  }

  @Get('export')
  async export(@Query() q: ExportQuery, @Res() res: Response) {
    const file = await this.data.export(q.scope, q.dataset, q.format ?? 'csv', q.q);
    res.setHeader('Content-Type', file.mime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    res.send(file.body);
  }

  @Delete('records')
  removeDataset(@Query() q: DatasetQuery) {
    return this.data.removeDataset(q.scope, q.dataset);
  }

  @Delete('records/:id')
  @HttpCode(204)
  removeRecord(@Param('id', ParseObjectIdPipe) id: string) {
    return this.data.removeRecord(id);
  }
}
