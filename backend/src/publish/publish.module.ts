import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsMongoId, IsOptional, IsString } from 'class-validator';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe.js';
import { Job, JobSchema, Task, TaskSchema } from '../jobs/schemas.js';
import { JobsModule } from '../jobs/jobs.module.js';
import { MediaModule } from '../media/media.module.js';
import { Post as PostDoc, PostSchema } from '../posts/post.schema.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { CampaignDto, PublicationQuery, PublishNowDto, PublishTestDto, UpcomingQuery, UpdatePublicationDto } from './campaign.dto.js';
import { Publication, PublicationSchema, PublishCampaign, PublishCampaignSchema } from './campaign.schema.js';
import { CampaignsService } from './campaigns.service.js';
import { parseFacebookUrl } from './facebook-url.js';
import { PLATFORM_INFO, PLATFORMS } from './platforms.js';
import { PublishSchedulerService } from './publish-scheduler.service.js';
import { DestinationCheckService } from './destination-check.service.js';
import { AiModule } from '../ai/ai.module.js';
import { AI_CLIENT_FACTORY, defaultClientFactory } from '../ai/ai.service.js';
import { SelectorDoctorService } from './selector-doctor.service.js';
import { SelectorVersion, SelectorVersionSchema } from './selector.schema.js';
import { SelectorsService } from './selectors.service.js';

class ParseDestinationDto {
  @IsString()
  url: string;
}

class SelectorEditDto {
  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

class SelectorAiFixDto {
  @IsMongoId()
  profileId: string;

  @IsIn(['self', 'page', 'group'])
  kind: 'self' | 'page' | 'group';

  @IsOptional()
  @IsString()
  url?: string;
}

@Controller('publish/selectors')
export class SelectorsController {
  constructor(
    private readonly selectors: SelectorsService,
    private readonly doctor: SelectorDoctorService,
  ) {}

  /** Selectors the publishers use: default, current value, last change. */
  @Get()
  list() {
    return this.selectors.list();
  }

  @Get(':key/history')
  history(@Param('key') key: string) {
    return this.selectors.history(key);
  }

  @Put(':key')
  edit(@Param('key') key: string, @Body() dto: SelectorEditDto) {
    return this.selectors.set(key, dto.value, { source: 'user', reason: dto.reason || 'Sửa tay' });
  }

  @Post(':key/revert')
  @HttpCode(200)
  revert(@Param('key') key: string) {
    return this.selectors.revert(key);
  }

  /** The AI reads the live page with this profile and repairs the selector (checked before saving). */
  @Post(':key/ai-fix')
  @HttpCode(200)
  aiFix(@Param('key') key: string, @Body() dto: SelectorAiFixDto) {
    const spec = this.selectors.spec(key);
    return this.doctor.fix(key, { profileId: dto.profileId, target: { platform: spec.platform, kind: dto.kind, url: dto.url }, trigger: 'manual' });
  }
}

class CheckDestinationDto {
  @IsString()
  url: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsMongoId({ each: true })
  profileIds: string[];
}

@Controller('publish')
export class PublishController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly scheduler: PublishSchedulerService,
    private readonly destinations: DestinationCheckService,
  ) {}

  /** Opens a Facebook Page / Group with each profile (read-only): logged in, member, can post. */
  @Post('check-destination')
  @HttpCode(200)
  checkDestination(@Body() dto: CheckDestinationDto) {
    return this.destinations.check(dto.url, dto.profileIds);
  }

  /** Formats, options and limits of each platform (for the post editor). */
  @Get('platforms')
  platforms() {
    return PLATFORMS.map((p) => PLATFORM_INFO[p]);
  }

  @Get('upcoming')
  upcoming(@Query() q: UpcomingQuery) {
    return this.campaigns.upcoming(q);
  }

  /** Checks the form of a Facebook Page / Group link (no browser). */
  @Post('parse-destination')
  @HttpCode(200)
  parseDestination(@Body() dto: ParseDestinationDto) {
    return parseFacebookUrl(dto.url);
  }

  /** Publish a post now to some targets (a one-shot campaign). */
  @Post('now')
  now(@Body() dto: PublishNowDto) {
    return this.campaigns.publishNow(dto);
  }

  /** Compose on the site and stop right before "Post" (watch it in the live view). */
  @Post('test')
  test(@Body() dto: PublishTestDto) {
    return this.scheduler.testJob(dto.postId, dto.target, dto.headless ?? false);
  }
}

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  list(@Query('flowId') flowId?: string) {
    return this.campaigns.list(flowId);
  }

  @Post()
  create(@Body() dto: CampaignDto) {
    return this.campaigns.create(dto);
  }

  @Post('preview')
  @HttpCode(200)
  preview(@Body() dto: CampaignDto) {
    return this.campaigns.preview(dto);
  }

  @Get(':id')
  get(@Param('id', ParseObjectIdPipe) id: string) {
    return this.campaigns.get(id);
  }

  @Put(':id')
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: CampaignDto) {
    return this.campaigns.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.campaigns.remove(id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  activate(@Param('id', ParseObjectIdPipe) id: string) {
    return this.campaigns.activate(id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@Param('id', ParseObjectIdPipe) id: string) {
    return this.campaigns.pause(id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@Param('id', ParseObjectIdPipe) id: string) {
    return this.campaigns.resume(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseObjectIdPipe) id: string) {
    return this.campaigns.cancel(id);
  }

  @Get(':id/publications')
  publications(@Param('id', ParseObjectIdPipe) id: string, @Query() q: PublicationQuery) {
    return this.campaigns.listPublications(id, q);
  }

  @Get(':id/stats')
  stats(@Param('id', ParseObjectIdPipe) id: string) {
    return this.campaigns.stats(id);
  }
}

@Controller('publications')
export class PublicationsController {
  constructor(private readonly campaigns: CampaignsService) {}

  /** Change the time or pin a post of a publication that hasn't run. */
  @Put(':id')
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdatePublicationDto) {
    return this.campaigns.updatePublication(id, dto);
  }

  @Post(':id/skip')
  @HttpCode(200)
  skip(@Param('id', ParseObjectIdPipe) id: string) {
    return this.campaigns.skipPublication(id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  retry(@Param('id', ParseObjectIdPipe) id: string) {
    return this.campaigns.retryPublication(id);
  }

  @Post(':id/mark-published')
  @HttpCode(200)
  markPublished(@Param('id', ParseObjectIdPipe) id: string) {
    return this.campaigns.markPublished(id);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PublishCampaign.name, schema: PublishCampaignSchema },
      { name: Publication.name, schema: PublicationSchema },
      { name: PostDoc.name, schema: PostSchema },
      { name: Task.name, schema: TaskSchema },
      { name: SelectorVersion.name, schema: SelectorVersionSchema },
      { name: Job.name, schema: JobSchema },
    ]),
    AiModule,
    JobsModule,
    ProfilesModule,
    MediaModule,
  ],
  controllers: [PublishController, CampaignsController, PublicationsController, SelectorsController],
  providers: [
    CampaignsService,
    PublishSchedulerService,
    DestinationCheckService,
    SelectorsService,
    SelectorDoctorService,
    { provide: AI_CLIENT_FACTORY, useValue: defaultClientFactory },
  ],
  exports: [CampaignsService],
})
export class PublishModule {}
