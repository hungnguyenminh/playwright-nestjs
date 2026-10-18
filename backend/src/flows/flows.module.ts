import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JobsModule } from '../jobs/jobs.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { ScriptsModule } from '../scripts/scripts.module.js';
import { Flow, FlowSchema } from './flow.schema.js';
import { FlowsController } from './flows.controller.js';
import { FlowsService } from './flows.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Flow.name, schema: FlowSchema }]),
    ScriptsModule,
    ProfilesModule,
    JobsModule,
  ],
  controllers: [FlowsController],
  providers: [FlowsService],
  exports: [FlowsService],
})
export class FlowsModule {}
