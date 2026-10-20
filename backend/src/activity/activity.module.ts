import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Job, JobSchema, Task, TaskSchema } from '../jobs/schemas.js';
import { ActivityEvents } from './activity.events.js';
import { ActivityInterceptor } from './activity.interceptor.js';
import { Activity, ActivitySchema } from './activity.schema.js';
import { ActivityService } from './activity.service.js';

class ActivityQueryDto {
  @IsOptional()
  @IsString()
  actor?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit = 50;
}

@Controller('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  /** ?actor=user,system,ai &category=… &level=… &q=… &from= &to= */
  @Get()
  list(@Query() q: ActivityQueryDto) {
    return this.activity.list(q);
  }

  @Get('categories')
  categories() {
    return this.activity.categories();
  }
}

/** System-wide activity log; ActivityService is injectable everywhere. */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Activity.name, schema: ActivitySchema },
      { name: Job.name, schema: JobSchema },
      { name: Task.name, schema: TaskSchema },
    ]),
  ],
  controllers: [ActivityController],
  providers: [ActivityService, ActivityEvents, { provide: APP_INTERCEPTOR, useClass: ActivityInterceptor }],
  exports: [ActivityService],
})
export class ActivityModule {}
