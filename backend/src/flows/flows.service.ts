import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { PageQuery } from '../common/pagination.js';
import { parseInputs } from '../common/parse-inputs.js';
import { JobsService } from '../jobs/jobs.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { ScriptsService } from '../scripts/scripts.service.js';
import { buildSourceJob, checkSource, cleanList, SOURCE_INFO, type SourceSpec } from '../sources/connectors.js';
import { FlowDto, RunFlowDto, SourceDto } from './flow.dto.js';
import { Flow } from './flow.schema.js';

@Injectable()
export class FlowsService {
  constructor(
    @InjectModel(Flow.name) private readonly flows: Model<Flow>,
    private readonly scripts: ScriptsService,
    private readonly profiles: ProfilesService,
    private readonly jobs: JobsService,
  ) {}

  /** Flows with their script / profile names and the status of the last run. */
  async list() {
    const [flows, scripts, profiles] = await Promise.all([
      this.flows.find().sort({ updatedAt: -1 }).lean(),
      this.scripts.list(),
      this.profiles.list(),
    ]);
    const lastJobs = await Promise.all(
      flows.map((f) => (f.lastJobId ? this.jobs.get(String(f.lastJobId)).catch(() => undefined) : undefined)),
    );
    return flows.map((f, i) => ({
      ...f,
      scriptName:
        f.kind === 'sources'
          ? (f.sources ?? []).map((src) => SOURCE_INFO[src.type]?.label ?? src.type).join(', ')
          : (scripts.find((s) => String(s._id) === String(f.scriptId))?.name ?? '(script đã bị xoá)'),
      profileName: f.profileId ? profiles.find((p) => String(p._id) === String(f.profileId))?.name ?? '(profile đã bị xoá)' : '',
      lastJob: lastJobs[i] ? { _id: lastJobs[i]!._id, status: lastJobs[i]!.status, totals: lastJobs[i]!.totals } : null,
    }));
  }

  async get(id: string) {
    const flow = await this.flows.findById(id).lean();
    if (!flow) throw new NotFoundException('Không tìm thấy luồng');
    return flow;
  }

  async create(dto: FlowDto) {
    await this.check(dto);
    return this.flows.create(this.toDoc(dto));
  }

  async update(id: string, dto: FlowDto) {
    await this.check(dto);
    const unset = {
      ...(dto.profileId ? {} : { profileId: 1 }),
      ...(dto.kind === 'sources' ? { scriptId: 1 } : {}),
    };
    const update = Object.keys(unset).length ? { ...this.toDoc(dto), $unset: unset } : this.toDoc(dto);
    const flow = await this.flows.findByIdAndUpdate(id, update, { returnDocument: 'after' }).lean();
    if (!flow) throw new NotFoundException('Không tìm thấy luồng');
    return flow;
  }

  /** Jobs and collected data are kept. */
  async remove(id: string) {
    const res = await this.flows.deleteOne({ _id: id });
    if (!res.deletedCount) throw new NotFoundException('Không tìm thấy luồng');
  }

  /**
   * Starts a job from the flow's settings (optionally overridden for this run
   * only). Source flows start one job per source, grouped by a run id.
   */
  async run(id: string, over: RunFlowDto = {}) {
    const flow = await this.get(id);
    if (flow.kind === 'sources') return this.runSources(id, flow, over);
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

  private async runSources(id: string, flow: Flow & { _id: Types.ObjectId }, over: RunFlowDto) {
    const runId = new Types.ObjectId();
    const n = flow.runs + 1;
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
    await this.flows.updateOne({ _id: id }, { $inc: { runs: 1 }, lastRunAt: new Date(), lastJobId: jobs[0]._id, lastRunId: runId });
    return { runId, jobs };
  }

  listJobs(id: string, q: PageQuery) {
    return this.jobs.list(q, id);
  }

  private async check(dto: FlowDto) {
    if (dto.kind === 'sources') {
      if (!dto.sources?.length) throw new BadRequestException('Chọn ít nhất một nguồn');
      const errors = dto.sources.flatMap((src) => checkSource(src));
      if (errors.length) throw new BadRequestException(errors.join('; '));
      for (const src of dto.sources) if (src.profileId) await this.checkProfile(src.profileId);
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

  private toDoc(dto: FlowDto) {
    const sources = dto.kind === 'sources';
    return {
      name: dto.name,
      description: dto.description ?? '',
      kind: sources ? ('sources' as const) : ('script' as const),
      ...(sources ? {} : { scriptId: new Types.ObjectId(dto.scriptId) }),
      sources: sources ? (dto.sources ?? []).map(toSourceSpec) : [],
      ...(dto.profileId && !sources ? { profileId: new Types.ObjectId(dto.profileId) } : {}),
      inputsText: dto.inputsText ?? '',
      vars: dto.vars ?? {},
      concurrency: dto.concurrency ?? 3,
      headless: dto.headless ?? true,
      maxRetries: dto.maxRetries ?? 0,
      stepTimeout: dto.stepTimeout ?? 30,
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
