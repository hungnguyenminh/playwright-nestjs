import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AI_CLIENT_FACTORY, defaultClientFactory } from '../ai/ai.service.js';
import { DataRecord, DataRecordSchema } from '../data/data-record.schema.js';
import { MediaModule } from '../media/media.module.js';
import { PostGeneratorService } from './post-generator.service.js';
import { Post, PostSchema } from './post.schema.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: DataRecord.name, schema: DataRecordSchema },
    ]),
    MediaModule,
  ],
  controllers: [PostsController],
  providers: [PostsService, PostGeneratorService, { provide: AI_CLIENT_FACTORY, useValue: defaultClientFactory }],
  exports: [PostsService, PostGeneratorService],
})
export class PostsModule {}
