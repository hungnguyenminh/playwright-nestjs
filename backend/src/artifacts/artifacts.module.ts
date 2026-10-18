import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Artifact, ArtifactSchema } from './artifact.schema.js';
import { ArtifactsController } from './artifacts.controller.js';
import { ArtifactsService } from './artifacts.service.js';

@Module({
  imports: [MongooseModule.forFeature([{ name: Artifact.name, schema: ArtifactSchema }])],
  controllers: [ArtifactsController],
  providers: [ArtifactsService],
  exports: [ArtifactsService],
})
export class ArtifactsModule {}
