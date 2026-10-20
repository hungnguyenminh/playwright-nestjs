import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DataRecord, DataRecordSchema } from '../data/data-record.schema.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { Job, JobSchema } from '../jobs/schemas.js';
import { PostsModule } from '../posts/posts.module.js';
import { Post, PostSchema } from '../posts/post.schema.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { PublishModule } from '../publish/publish.module.js';
import { ScriptsModule } from '../scripts/scripts.module.js';
import { Flow, FlowRun, FlowRunSchema, FlowSchema } from './flow.schema.js';
import { FlowsController } from './flows.controller.js';
import { FlowsService } from './flows.service.js';
import { PipelineService } from './pipeline.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Flow.name, schema: FlowSchema },
      { name: FlowRun.name, schema: FlowRunSchema },
      { name: Job.name, schema: JobSchema },
      { name: DataRecord.name, schema: DataRecordSchema },
      { name: Post.name, schema: PostSchema },
    ]),
    ScriptsModule,
    ProfilesModule,
    JobsModule,
    PostsModule,
    PublishModule,
  ],
  controllers: [FlowsController],
  providers: [FlowsService, PipelineService],
  exports: [FlowsService],
})
export class FlowsModule {}
