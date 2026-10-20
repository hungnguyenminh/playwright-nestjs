import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, QueryFilter, Types } from 'mongoose';
import { PageQuery } from '../common/pagination.js';
import { parseInputs } from '../common/parse-inputs.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import type { CampaignDto } from '../publish/campaign.dto.js';
import { CampaignsService } from '../publish/campaigns.service.js';
import { applyActiveHours, DAY, HOUR } from '../publish/time.js';
import { ScriptsService } from '../scripts/scripts.service.js';
import { buildSourceJob, checkSource, cleanList, SOURCE_INFO, type SourceSpec } from '../sources/connectors.js';
import { AutoRunDto, FlowDto, RunFlowDto, SourceDto } from './flow.dto.js';
import { type AutoRun, Flow, type FlowKind, FlowRun } from './flow.schema.js';

type FlowDoc = Flow & { _id: Types.ObjectId };

/** Next time an auto-run flow starts, inside its active hours. */
export function nextAutoRun(auto: Pick<AutoRun, 'every' | 'unit' | 'activeHours'>, from: Date): Date {
  const step = Math.max(1, auto.every) * (auto.unit === 'day' ? DAY : HOUR);
  return applyActiveHours(new Date(from.getTime() + step), auto.activeHours);
}

@Injectable()
export class FlowsService {
  constructor(
    @InjectModel(Flow.name) private readonly flows: Model<Flow>,
    @InjectModel(FlowRun.name) private readonly runsModel: Model<FlowRun>,
    private readonly scripts: ScriptsService,
    private readonly profiles: ProfilesService,
    private readonly jobs: JobsService,
    private readonly campaigns: CampaignsService,
  ) {}

  /** Flows (optionally of some kinds) with their script / source names and the status of the last run. */
  async list(kinds?: string) {
    const filter: QueryFilter<Flow> = kinds ? { kind: { $in: kinds.split(',') as FlowKind[] } } : {};
    const [flows, scripts, profiles] = await Promise.all([this.flows.find(filter).sort({ updatedAt: -1 }).lean(), this.scripts.list(), this.profiles.list()]);
    const lastJobs = await Promise.all(flows.map((f) => (f.lastJobId ? this.jobs.get(String(f.lastJobId)).catch(() => undefined) : undefined)));
    return flows.map((f, i) => ({
      ...f,
      scriptName:
        f.kind === 'script'
          ? (scripts.find((s) => String(s._id) === String(f.scriptId))?.name ?? '(script đã bị xoá)')
          : (f.sources ?? []).map((src) => SOURCE_INFO[src.type]?.label ?? src.type).join(', '),
      profileName: f.profileId ? (profiles.find((p) => String(p._id) === String(f.profileId))?.name ?? '(profile đã bị xoá)') : '',
      lastJob: lastJobs[i] ? { _id: lastJobs[i]!._id, status: lastJobs[i]!.status, totals: lastJobs[i]!.totals } : null,
    }));
  }

  async get(id: string): Promise<FlowDoc> {
    const flow = await this.flows.findById(id).lean();
    if (!flow) throw new NotFoundException('Không tìm thấy luồng');
    return flow as FlowDoc;
  }

  async create(dto: FlowDto) {
    await this.check(dto);
    const flow = await this.flows.create(this.toDoc(dto));
    if (dto.kind === 'pipeline') {
      try {
        const c = await this.campaigns.create(this.campaignDto(dto, String(flow._id)));
        await this.campaigns.activate(String(c._id));
        await this.flows.updateOne({ _id: flow._id }, { campaignId: c._id });
      } catch (err) {
        await this.flows.deleteOne({ _id: flow._id });
        throw err;
      }
    }
    return this.get(String(flow._id));
  }

  async update(id: string, dto: FlowDto) {
    const before = await this.get(id);
    if ((before.kind === 'pipeline') !== (dto.kind === 'pipeline')) throw new BadRequestException('Không đổi được loại luồng');
    await this.check(dto);
    const unset = {
      ...(dto.profileId ? {} : { profileId: 1 }),
      ...(dto.kind && dto.kind !== 'script' ? { scriptId: 1 } : {}),
      ...(dto.autoRun ? {} : { autoRun: 1 }),
    };
    const doc = this.toDoc(dto, before.autoRun);
    await this.flows.updateOne({ _id: id }, Object.keys(unset).length ? { ...doc, $unset: unset } : doc);
    if (dto.kind === 'pipeline' && before.campaignId) {
      const cid = String(before.campaignId);
      const c = await this.campaigns.get(cid);
      const wasActive = c.status === 'active';
      if (wasActive) await this.campaigns.pause(cid);
      if (['active', 'paused', 'draft'].includes(c.status)) await this.campaigns.update(cid, this.campaignDto(dto, id));
      if (wasActive) await this.campaigns.resume(cid);
    }
    return this.get(id);
  }

  /** Jobs, collected data and written posts are kept; a pipeline's schedule is removed. */
  async remove(id: string) {
    const flow = await this.get(id);
    if (flow.campaignId) {
      await this.campaigns.cancel(String(flow.campaignId)).catch(() => undefined);
      await this.campaigns.remove(String(flow.campaignId)).catch(() => undefined);
    }
    await this.flows.deleteOne({ _id: id });
    await this.runsModel.deleteMany({ flowId: flow._id });
  }

  /** Turns "run by itself" on / off (keeps the interval). */
  async setAutoRun(id: string, enabled: boolean) {
    const flow = await this.get(id);
    if (!flow.autoRun) throw new BadRequestException('Luồng chưa đặt lịch tự chạy (sửa luồng để đặt)');
    const autoRun = { ...flow.autoRun, enabled, nextRunAt: enabled ? nextAutoRun(flow.autoRun, new Date()) : flow.autoRun.nextRunAt };
    await this.flows.updateOne({ _id: id }, { autoRun });
    return this.get(id);
  }

  /**
   * Starts a run from the flow's settings (optionally overridden for this run
   * only). Source and pipeline flows start one job per source, grouped by a
   * run id and followed by a FlowRun (pipelines then write posts from new rows).
   */
  async run(id: string, over: RunFlowDto = {}, trigger: 'manual' | 'auto' = 'manual') {
    const flow = await this.get(id);
    if (flow.kind !== 'script') return this.runSources(id, flow, over, trigger);
    let inputs: Record<string, unknown>[];
    try {
      inputs = parseInputs(over.inputsText ?? flow.inputsText ?? '');
    } catch (err) {
      throw new BadRequestException(`Inputs: ${(err as Error).message}`);
    }
    const job = await this.jobs.create({
      name: `${flow.name} · lần ${flow.runs + 1}`,
      scriptId: String(flow.scriptId!),
      flowId: id,
      category: 'script',
      profileId: flow.profileId ? String(flow.profileId) : undefined,
      inputs,
      vars: over.vars ?? flow.vars,
      concurrency: flow.concurrency,
      headless: over.headless ?? flow.headless,
      maxRetries: flow.maxRetries,
      stepTimeout: flow.stepTimeout * 1000,
    });
    await this.flows.updateOne({ _id: id }, { $inc: { runs: 1 }, lastRunAt: new Date(), lastJobId: job._id });
    return job;
  }

  private async runSources(id: string, flow: FlowDoc, over: RunFlowDto, trigger: 'manual' | 'auto') {
    const runId = new Types.ObjectId();
    const n = flow.runs + 1;
    const startedAt = new Date();
    const jobs = [];
    for (const src of flow.sources ?? []) {
      const built = buildSourceJob(src);
      if (!built.inputs.length) continue;
      jobs.push(
        await this.jobs.create({
          name: `${flow.name} · ${built.name} · lần ${n}`,
          flowId: id,
          runId: String(runId),
          source: src.type,
          category: flow.kind === 'pipeline' ? 'pipeline' : 'crawl',
          actions: built.actions,
          inputs: built.inputs,
          vars: { ...built.vars, ...flow.vars, ...over.vars },
          profileId: src.profileId || undefined,
          concurrency: flow.concurrency,
          headless: over.headless ?? flow.headless,
          maxRetries: flow.maxRetries,
          stepTimeout: flow.stepTimeout * 1000,
        }),
      );
    }
    if (!jobs.length) throw new BadRequestException('Luồng chưa có nguồn nào để chạy');
    await this.runsModel.create({ flowId: flow._id, runId, status: 'crawling', trigger, jobs: jobs.length, startedAt });
    await this.flows.updateOne({ _id: id }, { $inc: { runs: 1 }, lastRunAt: startedAt, lastJobId: jobs[0]._id, lastRunId: runId });
    return { runId, jobs };
  }

  listJobs(id: string, q: PageQuery) {
    return this.jobs.list(q, id);
  }

  listRuns(id: string) {
    return this.runsModel.find({ flowId: new Types.ObjectId(id) }).sort({ startedAt: -1 }).limit(100).lean();
  }

  private async check(dto: FlowDto) {
    if (dto.kind === 'sources' || dto.kind === 'pipeline') {
      if (!dto.sources?.length) throw new BadRequestException('Chọn ít nhất một nguồn');
      const errors = dto.sources.flatMap((src) => checkSource(src));
      if (errors.length) throw new BadRequestException(errors.join('; '));
      for (const src of dto.sources) if (src.profileId) await this.checkProfile(src.profileId);
      if (dto.kind === 'pipeline') {
        if (!dto.generate?.platforms.length) throw new BadRequestException('Chọn nền tảng cho bài AI viết');
        const preview = await this.campaigns.preview(this.campaignDto(dto, new Types.ObjectId().toString()));
        if (preview.errors.length) throw new BadRequestException(preview.errors.join('; '));
      }
      return;
    }
    await this.scripts.get(dto.scriptId!);
    if (dto.profileId) await this.checkProfile(dto.profileId);
    try {
      parseInputs(dto.inputsText ?? '');
    } catch (err) {
      throw new BadRequestException(`Inputs: ${(err as Error).message}`);
    }
  }

  private async checkProfile(profileId: string) {
    if (!isValidObjectId(profileId)) throw new BadRequestException('profileId không hợp lệ');
    await this.profiles.get(profileId);
  }

  /** The pipeline's publishing campaign: posts come from the flow, the schedule never ends, it waits for new posts. */
  private campaignDto(dto: FlowDto, flowId: string): CampaignDto {
    const c = (dto.campaign ?? {}) as Partial<CampaignDto>;
    return {
      name: `${dto.name} · lịch đăng`,
      destinations: c.destinations ?? [],
      postSource: { type: 'flow', flowId },
      order: 'sequential',
      whenExhausted: 'wait',
      assignment: c.assignment ?? 'same',
      staggerMinutes: c.staggerMinutes ?? 60,
      minGapMinutes: c.minGapMinutes ?? 60,
      schedule: { ...(c.schedule ?? { mode: 'interval', every: 1, unit: 'hour' }), mode: 'interval', count: undefined },
      catchUp: c.catchUp ?? 'shift',
      headless: c.headless ?? true,
      dryRun: c.dryRun ?? false,
      flowId,
    };
  }

  private autoRunDoc(a: AutoRunDto | undefined, before?: AutoRun): AutoRun | undefined {
    if (!a) return undefined;
    const same = before && before.enabled === a.enabled && before.every === a.every && before.unit === a.unit;
    return {
      enabled: a.enabled,
      every: a.every,
      unit: a.unit,
      ...(a.activeHours?.from && a.activeHours.to ? { activeHours: { from: a.activeHours.from, to: a.activeHours.to } } : {}),
      // Keep the planned time when nothing about the timing changed.
      nextRunAt: same && before?.nextRunAt ? before.nextRunAt : nextAutoRun(a, new Date()),
    };
  }

  private toDoc(dto: FlowDto, beforeAutoRun?: AutoRun) {
    const kind = dto.kind ?? 'script';
    const fromSources = kind !== 'script';
    return {
      name: dto.name,
      description: dto.description ?? '',
      kind,
      ...(fromSources ? {} : { scriptId: new Types.ObjectId(dto.scriptId) }),
      sources: fromSources ? (dto.sources ?? []).map(toSourceSpec) : [],
      ...(dto.profileId && !fromSources ? { profileId: new Types.ObjectId(dto.profileId) } : {}),
      inputsText: dto.inputsText ?? '',
      vars: dto.vars ?? {},
      concurrency: dto.concurrency ?? 3,
      headless: dto.headless ?? true,
      maxRetries: dto.maxRetries ?? 0,
      stepTimeout: dto.stepTimeout ?? 30,
      ...(dto.autoRun ? { autoRun: this.autoRunDoc(dto.autoRun, beforeAutoRun) } : {}),
      ...(kind === 'pipeline' && dto.generate
        ? {
            generate: {
              mode: dto.generate.mode,
              ...(dto.generate.mode === 'digest' ? { digestSize: dto.generate.digestSize ?? 5 } : {}),
              prompt: dto.generate.prompt ?? '',
              tone: dto.generate.tone,
              length: dto.generate.length ?? 'medium',
              language: dto.generate.language,
              platforms: dto.generate.platforms,
              maxPostsPerRun: dto.generate.maxPostsPerRun ?? 5,
              filter: dto.generate.filter,
              attachImage: !!dto.generate.attachImage,
              approval: dto.generate.approval ?? 'review',
            },
          }
        : {}),
    };
  }
}

/** Stored form of a source: cleaned lists, empty options left out. */
function toSourceSpec(src: SourceDto): SourceSpec {
  return {
    type: src.type,
    targets: cleanList(src.targets),
    ...(src.type === 'website' ? { keywords: cleanList(src.keywords) } : {}),
    ...(src.limit ? { limit: src.limit } : {}),
    detail: !!src.detail,
    ...(src.profileId ? { profileId: src.profileId } : {}),
  };
}
