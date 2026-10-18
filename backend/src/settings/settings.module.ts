import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiSettingsService } from './ai-settings.service.js';
import { SettingsController } from './settings.controller.js';
import { Setting, SettingSchema } from './setting.schema.js';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Setting.name, schema: SettingSchema }]),
  ],
  controllers: [SettingsController],
  providers: [AiSettingsService],
  exports: [AiSettingsService],
})
export class SettingsModule {}
