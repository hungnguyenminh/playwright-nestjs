import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Flow, FlowSchema } from '../flows/flow.schema.js';
import { Job, JobSchema, Task, TaskSchema } from '../jobs/schemas.js';
import { Script, ScriptSchema } from '../scripts/script.schema.js';
import { DataController } from './data.controller.js';
import { DataRecord, DataRecordSchema } from './data-record.schema.js';
import { DataService } from './data.service.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DataRecord.name, schema: DataRecordSchema },
      { name: Task.name, schema: TaskSchema },
      { name: Job.name, schema: JobSchema },
      { name: Script.name, schema: ScriptSchema },
      { name: Flow.name, schema: FlowSchema },
    ]),
  ],
  controllers: [DataController],
  providers: [DataService],
})
export class DataModule {}
