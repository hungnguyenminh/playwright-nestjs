import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SourcesController } from './sources.controller.js';

@Module({
  imports: [JobsModule, ProfilesModule],
  controllers: [SourcesController],
})
export class SourcesModule {}
