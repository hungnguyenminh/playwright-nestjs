import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { createReadStream } from 'node:fs';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe.js';
import { MediaService, UploadedFileLike } from './media.service.js';

/** Size hints from the browser, used when the server can't read the file (e.g. WebM). */
class UploadHintDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  height?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  duration?: number;
}

class FromUrlDto {
  @IsString()
  url: string;
}

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  list(@Query('kind') kind?: string) {
    return this.media.list(kind);
  }

  /** multipart/form-data with field "file" (+ optional width / height / duration). */
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: UploadedFileLike | undefined, @Body() hint: UploadHintDto) {
    if (!file) throw new BadRequestException('Thiếu file (field "file")');
    return this.media.fromUpload(file, hint);
  }

  @Post('from-url')
  fromUrl(@Body() dto: FromUrlDto) {
    return this.media.fromUrl(dto.url.trim());
  }

  @Get(':id')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.media.get(id);
  }

  @Get(':id/file')
  async file(@Param('id', ParseObjectIdPipe) id: string) {
    const m = await this.media.fileOf(id);
    return new StreamableFile(createReadStream(m.path), {
      type: m.mime,
      length: m.size,
      disposition: `inline; filename="${encodeURIComponent(m.name)}"`,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.media.remove(id);
  }
}
