import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiSettingsService } from './ai-settings.service.js';
import { ensureSettingsSecret, SecretBox } from './secret-box.js';
import { SettingsController } from './settings.controller.js';
import { Setting, SettingSchema } from './setting.schema.js';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Setting.name, schema: SettingSchema }]),
  ],
  controllers: [SettingsController],
  providers: [
    AiSettingsService,
    // One key (SETTINGS_SECRET) for every secret stored in Mongo: AI token, profile sessions.
    { provide: SecretBox, useFactory: () => new SecretBox(ensureSettingsSecret()) },
  ],
  exports: [AiSettingsService, SecretBox],
})
export class SettingsModule {}
