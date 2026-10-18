import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ActionsController } from './actions/actions.controller.js';
import { AiModule } from './ai/ai.module.js';
import { ArtifactsModule } from './artifacts/artifacts.module.js';
import { BrowserModule } from './browser/browser.module.js';
import { appConfig } from './config/app.config.js';
import { DataModule } from './data/data.module.js';
import { DatabaseModule } from './database/database.module.js';
import { FlowsModule } from './flows/flows.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { LiveModule } from './live/live.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { ScriptsModule } from './scripts/scripts.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { SourcesModule } from './sources/sources.module.js';
import { SystemController } from './system.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    BrowserModule,
    ScriptsModule,
    ProfilesModule,
    ArtifactsModule,
    JobsModule,
    LiveModule,
    SettingsModule,
    AiModule,
    FlowsModule,
    DataModule,
    SourcesModule,
  ],
  controllers: [ActionsController, SystemController],
})
export class AppModule {}
