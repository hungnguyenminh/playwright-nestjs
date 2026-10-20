import { Module } from '@nestjs/common';
import { ArtifactsModule } from '../artifacts/artifacts.module.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { ScriptsModule } from '../scripts/scripts.module.js';
import { AiController } from './ai.controller.js';
import {
  AI_CLIENT_FACTORY,
  AiService,
  defaultClientFactory,
} from './ai.service.js';
import { PageSnapshotService } from './page-snapshot.service.js';

@Module({
  imports: [ScriptsModule, ProfilesModule, JobsModule, ArtifactsModule],
  controllers: [AiController],
  providers: [
    AiService,
    PageSnapshotService,
    { provide: AI_CLIENT_FACTORY, useValue: defaultClientFactory },
  ],
  exports: [PageSnapshotService],
})
export class AiModule {}
