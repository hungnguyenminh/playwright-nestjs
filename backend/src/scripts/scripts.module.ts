import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Script, ScriptSchema } from './script.schema.js';
import { ScriptsController } from './scripts.controller.js';
import { ScriptsService } from './scripts.service.js';

@Module({
  imports: [MongooseModule.forFeature([{ name: Script.name, schema: ScriptSchema }])],
  controllers: [ScriptsController],
  providers: [ScriptsService],
  exports: [ScriptsService],
})
export class ScriptsModule {}
