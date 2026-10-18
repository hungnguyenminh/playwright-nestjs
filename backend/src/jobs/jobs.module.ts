import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ArtifactsModule } from '../artifacts/artifacts.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { ScriptsModule } from '../scripts/scripts.module.js';
import { JobRunnerService } from './job-runner.service.js';
import { JobsController, TasksController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';
import {
  Job,
  JobSchema,
  Task,
  TaskLog,
  TaskLogSchema,
  TaskSchema,
} from './schemas.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Job.name, schema: JobSchema },
      { name: Task.name, schema: TaskSchema },
      { name: TaskLog.name, schema: TaskLogSchema },
    ]),
    ScriptsModule,
    ProfilesModule,
    ArtifactsModule,
  ],
  controllers: [JobsController, TasksController],
  providers: [JobsService, JobRunnerService],
  exports: [JobRunnerService],
})
export class JobsModule {}
