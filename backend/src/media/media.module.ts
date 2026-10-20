import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { join } from 'node:path';
import { appConfig, type AppConfig } from '../config/app.config.js';
import { MediaController } from './media.controller.js';
import { Media, MediaSchema } from './media.schema.js';
import { MediaService } from './media.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Media.name, schema: MediaSchema }]),
    MulterModule.registerAsync({
      inject: [appConfig.KEY],
      useFactory: (config: AppConfig) => ({
        dest: join(config.storageDir, 'media', '.upload'),
        limits: { fileSize: config.mediaMaxMb * 1024 * 1024 },
      }),
    }),
  ],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
