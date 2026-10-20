import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe.js';
import { BulkStatusDto, CheckPostDto, GeneratePostsDto, PostDto, PostQuery } from './post.dto.js';
import { PostGeneratorService } from './post-generator.service.js';
import { PostsService } from './posts.service.js';

@Controller('posts')
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly generator: PostGeneratorService,
  ) {}

  @Get()
  list(@Query() q: PostQuery) {
    return this.posts.list(q);
  }

  @Get('tags')
  tags() {
    return this.posts.tags();
  }

  @Post()
  create(@Body() dto: PostDto) {
    return this.posts.create(dto);
  }

  /** Live check of an unsaved post: format, composed text, counts, errors per platform. */
  @Post('check')
  @HttpCode(200)
  check(@Body() dto: CheckPostDto) {
    return this.posts.check(dto.post, dto.platforms);
  }

  /** AI writes posts from data rows (Data page "Tạo bài", crawl → publish flows). */
  @Post('generate')
  generate(@Body() dto: GeneratePostsDto) {
    return this.generator.generate(dto);
  }

  @Post('bulk-status')
  @HttpCode(200)
  bulkStatus(@Body() dto: BulkStatusDto) {
    return this.posts.bulkStatus(dto);
  }

  @Get(':id')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.posts.get(id);
  }

  @Put(':id')
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: PostDto) {
    return this.posts.update(id, dto);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id', ParseObjectIdPipe) id: string) {
    return this.posts.duplicate(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.posts.remove(id);
  }
}
