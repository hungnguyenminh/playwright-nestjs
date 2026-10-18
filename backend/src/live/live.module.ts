import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module.js';
import { LiveGateway } from './live.gateway.js';
import { ScreencastService } from './screencast.service.js';
import { TakeoverService } from './takeover.service.js';

@Module({
  imports: [JobsModule],
  providers: [LiveGateway, ScreencastService, TakeoverService],
})
export class LiveModule {}
