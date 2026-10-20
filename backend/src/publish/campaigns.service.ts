import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ActivityService } from '../activity/activity.service.js';
import { Events } from '../common/events.js';
import { MediaService } from '../media/media.service.js';
import { Post } from '../posts/post.schema.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { CampaignDto, PublicationQuery, PublishNowDto, UpcomingQuery, UpdatePublicationDto } from './campaign.dto.js';
import { OPEN_STATUSES, Publication, PublicationStatus, PublishCampaign } from './campaign.schema.js';
import { parseFacebookUrl } from './facebook-url.js';
import {
  type CampaignSpec,
  computeSlots,
  DEFAULT_LIMITS,
  type DestinationSpec,
  planPublications,
  type ScheduleSpec,
} from './plan.js';
import { checkPostFor, PLATFORM_INFO } from './platforms.js';
import { DAY, isValidHours, MINUTE } from './time.js';

const oid = (id: string) => new Types.ObjectId(id);
const UNIT_MIN = { minute: 1, hour: 60, day: 1440 } as const;
/** Publications shown by the preview. */
const PREVIEW_MAX = 60;

type CampaignDoc = PublishCampaign & { _id: Types.ObjectId };

@Injectable()
export class CampaignsService {
  constructor(
    @InjectModel(PublishCampaign.name) readonly campaigns: Model<PublishCampaign>,
    @InjectModel(Publication.name) readonly publications: Model<Publication>,
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    private readonly profiles: ProfilesService,
    private readonly media: MediaService,
    private readonly events: EventEmitter2,
    private readonly activity: ActivityService,
  ) {}

  // ---- campaigns -------------------------------------------------------------------

  async list(flowId?: string) {
    const list = await this.campaigns
      .find(flowId ? { flowId: oid(flowId) } : {})
      .sort({ updatedAt: -1 })
      .lean();
    const ids = list.map((c) => c._id);
    const [totals, next] = await Promise.all([
      this.publications.aggregate<{ _id: { c: Types.ObjectId; s: string }; n: number }>([
        { $match: { campaignId: { $in: ids } } },
        { $group: { _id: { c: '$campaignId', s: '$status' }, n: { $sum: 1 } } },
      ]),
      this.publications.aggregate<{ _id: Types.ObjectId; at: Date }>([
        { $match: { campaignId: { $in: ids }, status: { $in: ['scheduled', 'waiting'] } } },
        { $group: { _id: '$campaignId', at: { $min: '$scheduledAt' } } },
      ]),
    ]);
    return list.map((c) => ({
      ...c,
      totals: Object.fromEntries(totals.filter((t) => String(t._id.c) === String(c._id)).map((t) => [t._id.s, t.n])),
      nextAt: next.find((x) => String(x._id) === String(c._id))?.at ?? null,
    }));
  }

  async get(id: string): Promise<CampaignDoc> {
    const c = await this.campaigns.findById(id).lean();
    if (!c) throw new NotFoundException('Không tìm thấy chiến dịch');
    return c as CampaignDoc;
  }

  async create(dto: CampaignDto) {
    const doc = this.normalize(dto);
    return this.campaigns.create({ ...doc, status: 'draft' });
  }

  async update(id: string, dto: CampaignDto) {
    const c = await this.get(id);
    if (c.status === 'active') throw new ConflictException('Tạm dừng chiến dịch trước khi sửa');
    const doc = this.normalize(dto);
    await this.campaigns.updateOne({ _id: id }, doc);
    // Upcoming publications follow the new settings.
    if (c.status === 'paused') {
      await this.publications.deleteMany({ campaignId: c._id, status: { $in: ['scheduled', 'waiting'] } });
      await this.campaigns.updateOne({ _id: id }, { planCursor: null });
      await this.generate(await this.get(id), new Date(), true);
    }
    return this.get(id);
  }

  async remove(id: string) {
    const c = await this.get(id);
    if (await this.publications.exists({ campaignId: c._id, status: 'running' })) {
      throw new ConflictException('Có lượt đăng đang chạy, đợi xong rồi xoá');
    }
    await this.publications.deleteMany({ campaignId: c._id });
    await this.campaigns.deleteOne({ _id: c._id });
  }

  /** Planned publications (first ones) and problems, without saving anything. */
  async preview(dto: CampaignDto) {
    const doc = this.normalize(dto);
    const spec = { ...doc, _id: 'preview' } as unknown as CampaignSpec;
    const check = await this.check(spec);
    const now = new Date();
    const { slots } = computeSlots(spec, { now, until: new Date(now.getTime() + 30 * DAY) });
    const planned = planPublications(spec, this.rebase(spec, slots, now)).slice(0, PREVIEW_MAX);
    return { ...check, publications: planned, total: planned.length };
  }

  async activate(id: string) {
    const c = await this.get(id);
    if (!['draft', 'paused'].includes(c.status)) throw new ConflictException(`Chiến dịch đang "${c.status}"`);
    const { errors } = await this.check(this.spec(c));
    if (errors.length) throw new BadRequestException(errors.join('; '));
    if (c.status === 'paused') return this.resume(id);
    await this.campaigns.updateOne({ _id: id }, { planCursor: null, rotationCursors: c.destinations.map(() => 0) });
    await this.generate(await this.get(id), new Date(), true);
    // Active only once its publications exist: a scheduler tick in between would see an empty, finished campaign.
    await this.campaigns.updateOne({ _id: id }, { status: 'active', activatedAt: new Date() });
    this.addLog(id, 'Kích hoạt');
    return this.get(id);
  }

  async pause(id: string) {
    const c = await this.get(id);
    if (c.status !== 'active') throw new ConflictException('Chiến dịch không chạy');
    await this.campaigns.updateOne({ _id: id }, { status: 'paused' });
    this.addLog(id, 'Tạm dừng');
    return this.get(id);
  }

  /** Back to active: overdue publications are moved by the scheduler's next tick (catch-up rule). */
  async resume(id: string) {
    const c = await this.get(id);
    if (c.status !== 'paused') throw new ConflictException('Chiến dịch không ở trạng thái tạm dừng');
    await this.campaigns.updateOne({ _id: id }, { status: 'active' });
    this.addLog(id, 'Tiếp tục');
    return this.get(id);
  }

  async cancel(id: string) {
    const c = await this.get(id);
    await this.publications.updateMany({ campaignId: c._id, status: { $in: ['scheduled', 'waiting'] } }, { status: 'cancelled' });
    await this.campaigns.updateOne({ _id: id }, { status: 'cancelled', planCursor: null });
    this.addLog(id, 'Huỷ');
    return this.get(id);
  }

  // ---- publications ------------------------------------------------------------------

  async listPublications(id: string, q: PublicationQuery) {
    const filter: Record<string, unknown> = { campaignId: oid(id) };
    if (q.status) filter.status = { $in: q.status.split(',') };
    if (q.destIndex !== undefined) filter.destIndex = q.destIndex;
    if (q.profileId) filter.$or = [{ profileId: oid(q.profileId) }, { plannedProfileId: oid(q.profileId) }];
    const [items, total] = await Promise.all([
      this.publications
        .find(filter)
        .sort({ scheduledAt: 1, destIndex: 1, laneIndex: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.publications.countDocuments(filter),
    ]);
    return { items: await this.decorate(items), total, page: q.page, limit: q.limit };
  }

  /** Posts per profile × destination (published / pending / failed). */
  async stats(id: string) {
    return this.publications.aggregate([
      { $match: { campaignId: oid(id), profileId: { $ne: null } } },
      { $group: { _id: { destIndex: '$destIndex', profileId: '$profileId', status: '$status' }, n: { $sum: 1 } } },
      { $project: { _id: 0, destIndex: '$_id.destIndex', profileId: '$_id.profileId', status: '$_id.status', n: 1 } },
    ]);
  }

  /** Upcoming publications of every campaign (overview tab), plus recent failures. */
  async upcoming(q: UpcomingQuery) {
    const from = q.from ? new Date(q.from) : new Date(Date.now() - DAY);
    const to = q.to ? new Date(q.to) : new Date(Date.now() + 7 * DAY);
    const filter: Record<string, unknown> = { scheduledAt: { $gte: from, $lte: to } };
    if (q.platform) filter.platform = q.platform;
    if (q.profileId) filter.$or = [{ profileId: oid(q.profileId) }, { plannedProfileId: oid(q.profileId) }];
    const [items, failed] = await Promise.all([
      this.publications.find(filter).sort({ scheduledAt: 1 }).limit(500).lean(),
      this.publications
        .find({ status: { $in: ['failed', 'unknown'] }, finishedAt: { $gte: new Date(Date.now() - 7 * DAY) } })
        .sort({ finishedAt: -1 })
        .limit(20)
        .lean(),
    ]);
    return { items: await this.decorate(items), failed: await this.decorate(failed) };
  }

  async updatePublication(id: string, dto: UpdatePublicationDto) {
    const pub = await this.openPublication(id, ['scheduled', 'waiting']);
    const set: Record<string, unknown> = {};
    if (dto.scheduledAt) set.scheduledAt = new Date(dto.scheduledAt);
    if (dto.postId) {
      if (!(await this.posts.exists({ _id: dto.postId }))) throw new BadRequestException('Không tìm thấy bài');
      Object.assign(set, { postId: oid(dto.postId), plannedPostId: oid(dto.postId), pinned: true });
    }
    await this.publications.updateOne({ _id: pub._id }, set);
    return this.emitPublication(id);
  }

  async skipPublication(id: string) {
    await this.openPublication(id, ['scheduled', 'waiting']);
    await this.publications.updateOne({ _id: id }, { status: 'skipped', finishedAt: new Date() });
    return this.emitPublication(id);
  }

  /** Runs a failed / unknown / skipped publication again, now. */
  async retryPublication(id: string) {
    const pub = await this.openPublication(id, ['failed', 'unknown', 'skipped', 'cancelled']);
    const c = await this.get(String(pub.campaignId));
    if (c.status !== 'active') throw new ConflictException('Kích hoạt chiến dịch trước');
    await this.publications.updateOne(
      { _id: id },
      { status: 'scheduled', scheduledAt: new Date(), attempts: [], $unset: { error: 1, jobId: 1, taskId: 1, finishedAt: 1, waitReason: 1 } },
    );
    return this.emitPublication(id);
  }

  /** "It was posted after all" for unknown results. */
  async markPublished(id: string) {
    const pub = await this.openPublication(id, ['unknown', 'failed']);
    await this.publications.updateOne({ _id: id }, { status: 'published', finishedAt: pub.finishedAt ?? new Date() });
    if (pub.postId) await this.posts.updateOne({ _id: pub.postId }, { $inc: { usedCount: 1 }, lastPublishedAt: new Date() });
    return this.emitPublication(id);
  }

  /** "Đăng ngay": a one-shot campaign, every target with its own account. */
  async publishNow(dto: PublishNowDto) {
    const post = await this.posts.findById(dto.postId, { title: 1 }).lean();
    if (!post) throw new NotFoundException('Không tìm thấy bài');
    const c = await this.create({
      name: `Đăng ngay · ${post.title}`,
      destinations: dto.targets.map((t) => ({ platform: t.platform, kind: t.kind, url: t.url, profileIds: [t.profileId], accountMode: 'all' as const })),
      postSource: { type: 'list', postIds: [dto.postId] },
      schedule: { mode: 'once' },
      staggerMinutes: 0,
      minGapMinutes: 0,
      headless: dto.headless ?? true,
    });
    return this.activate(String(c._id));
  }

  // ---- shared ------------------------------------------------------------------------

  spec(c: CampaignDoc): CampaignSpec {
    return { ...(c as unknown as CampaignSpec), _id: String(c._id) };
  }

  /**
   * Creates the publications of the next slots. First call (`initial`) starts
   * the schedule; later calls extend endless schedules a week ahead.
   */
  async generate(c: CampaignDoc, now: Date, initial = false) {
    if (!initial && !c.planCursor) return 0;
    const spec = this.spec(c);
    const { slots, cursor } = computeSlots(spec, {
      now,
      until: new Date(now.getTime() + 7 * DAY),
      from: initial ? undefined : (c.planCursor ?? undefined),
    });
    const ready = initial ? this.rebase(spec, slots, now) : slots;
    const planned = planPublications(spec, ready);
    if (planned.length) {
      await this.publications
        .insertMany(
          planned.map((p) => ({
            campaignId: c._id,
            slot: p.slot,
            destIndex: p.destIndex,
            lane: p.lane,
            laneIndex: p.laneIndex,
            platform: spec.destinations[p.destIndex].platform,
            kind: spec.destinations[p.destIndex].kind,
            url: spec.destinations[p.destIndex].url,
            plannedProfileId: p.plannedProfileId ? oid(p.plannedProfileId) : undefined,
            plannedPostId: p.plannedPostId ? oid(p.plannedPostId) : undefined,
            postId: p.postId ? oid(p.postId) : undefined,
            pinned: !!p.postId,
            scheduledAt: p.scheduledAt,
            originalAt: p.scheduledAt,
          })),
          { ordered: false },
        )
        .catch((err: { code?: number }) => {
          // Duplicate (campaign, slot, destination, lane): already generated.
          if (err.code !== 11000) throw err;
        });
    }
    await this.campaigns.updateOne({ _id: c._id }, { planCursor: cursor ?? null });
    return planned.length;
  }

  /** An interval that started in the past begins now (activation is not downtime). */
  private rebase(spec: CampaignSpec, slots: ReturnType<typeof computeSlots>['slots'], now: Date) {
    if (spec.schedule.mode !== 'interval' || !slots.length || slots[0].at.getTime() >= now.getTime()) return slots;
    const delta = now.getTime() - slots[0].at.getTime();
    return slots.map((s) => ({ ...s, at: new Date(s.at.getTime() + delta), base: new Date(s.base.getTime() + delta) }));
  }

  addLog(id: string | Types.ObjectId, message: string) {
    void this.campaigns.updateOne({ _id: id }, { $push: { log: { $each: [{ at: new Date(), message }], $slice: -50 } } }).exec();
    void this.campaigns.findById(id, { name: 1 }).lean().then((c) =>
      this.activity.log({ actor: 'system', category: 'campaign', action: 'campaign.log', summary: `Lịch đăng "${c?.name ?? id}": ${message}`, target: { type: 'campaign', id, name: c?.name } }),
    );
  }

  async emitPublication(id: string | Types.ObjectId) {
    const pub = await this.publications.findById(id).lean();
    if (pub) this.events.emit(Events.PublicationUpdated, { ...pub, _id: String(pub._id), campaignId: String(pub.campaignId) });
    return pub;
  }

  private async openPublication(id: string, statuses: PublicationStatus[]) {
    const pub = await this.publications.findById(id).lean();
    if (!pub) throw new NotFoundException('Không tìm thấy lượt đăng');
    if (!statuses.includes(pub.status)) throw new ConflictException(`Lượt đăng đang "${pub.status}"`);
    return pub;
  }

  /** Adds post titles and profile names for display. */
  private async decorate<T extends { postId?: Types.ObjectId; plannedPostId?: Types.ObjectId; profileId?: Types.ObjectId; plannedProfileId?: Types.ObjectId; campaignId: Types.ObjectId }>(items: T[]) {
    const postIds = [...new Set(items.flatMap((p) => [p.postId, p.plannedPostId]).filter(Boolean).map(String))];
    const campaignIds = [...new Set(items.map((p) => String(p.campaignId)))];
    const [posts, profiles, campaigns] = await Promise.all([
      this.posts.find({ _id: { $in: postIds } }, { title: 1 }).lean(),
      this.profiles.list(),
      this.campaigns.find({ _id: { $in: campaignIds } }, { name: 1 }).lean(),
    ]);
    const title = (id?: Types.ObjectId) => (id ? posts.find((p) => String(p._id) === String(id))?.title : undefined);
    const name = (id?: Types.ObjectId) => (id ? profiles.find((p) => String(p._id) === String(id))?.name : undefined);
    return items.map((p) => ({
      ...p,
      postTitle: title(p.postId) ?? title(p.plannedPostId),
      profileName: name(p.profileId) ?? name(p.plannedProfileId),
      campaignName: campaigns.find((c) => String(c._id) === String(p.campaignId))?.name,
    }));
  }

  // ---- validation ----------------------------------------------------------------------

  private normalize(dto: CampaignDto) {
    const destinations: DestinationSpec[] = dto.destinations.map((d, i) => {
      const label = `Điểm đăng ${i + 1} (${PLATFORM_INFO[d.platform].label})`;
      let url: string | undefined;
      if (d.platform === 'facebook' && d.kind !== 'self') {
        if (!d.url?.trim()) throw new BadRequestException(`${label}: nhập link ${d.kind === 'page' ? 'Page' : 'Group'}`);
        const parsed = parseFacebookUrl(d.url);
        if ('error' in parsed) throw new BadRequestException(`${label}: ${parsed.error}`);
        if (parsed.kind !== d.kind) throw new BadRequestException(`${label}: link này là ${parsed.kind === 'group' ? 'Group' : 'Page'}, không phải ${d.kind === 'group' ? 'Group' : 'Page'}`);
        url = parsed.url;
      } else if (d.kind !== 'self') {
        throw new BadRequestException(`${label}: chỉ đăng lên kênh / trang của chính tài khoản`);
      }
      return {
        platform: d.platform,
        kind: d.kind,
        url,
        profileIds: [...new Set(d.profileIds)],
        accountMode: d.accountMode,
        rotate: d.accountMode === 'rotate' ? { strategy: d.rotate?.strategy ?? 'roundRobin', startOffset: d.rotate?.startOffset ?? i } : undefined,
        limits: { ...DEFAULT_LIMITS, ...d.limits },
      };
    });
    const ps = dto.postSource as Record<string, any>;
    let postSource: CampaignSpec['postSource'];
    if (ps?.type === 'flow') {
      if (!Types.ObjectId.isValid(ps.flowId)) throw new BadRequestException('Kho bài theo luồng cần flowId');
      postSource = { type: 'flow', flowId: String(ps.flowId) };
    } else if (ps?.type === 'list') {
      const ids = (Array.isArray(ps.postIds) ? ps.postIds : []).filter((x: unknown) => Types.ObjectId.isValid(String(x))).map(String);
      const separate = ps.separate && typeof ps.separate === 'object' ? Object.fromEntries(Object.entries(ps.separate as Record<string, unknown>).map(([k, v]) => [k, (Array.isArray(v) ? v : []).map(String)])) : undefined;
      postSource = { type: 'list', postIds: ids, ...(separate ? { separate } : {}) };
    } else {
      throw new BadRequestException('postSource phải là { type: "list", postIds } hoặc { type: "flow", flowId }');
    }
    return {
      name: dto.name.trim(),
      flowId: dto.flowId ? oid(dto.flowId) : undefined,
      destinations,
      postSource,
      order: dto.order ?? 'sequential',
      whenExhausted: dto.whenExhausted ?? (postSource.type === 'flow' ? 'wait' : 'stop'),
      assignment: dto.assignment ?? 'same',
      staggerMinutes: dto.staggerMinutes ?? 60,
      minGapMinutes: dto.minGapMinutes ?? 60,
      schedule: this.normalizeSchedule(dto.schedule),
      catchUp: dto.catchUp ?? 'shift',
      timezone: dto.timezone || 'Asia/Ho_Chi_Minh',
      headless: dto.headless ?? true,
      dryRun: dto.dryRun ?? false,
    };
  }

  private normalizeSchedule(raw: Record<string, any>): ScheduleSpec {
    const date = (v: unknown, what: string) => {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) throw new BadRequestException(`${what}: ngày giờ không hợp lệ`);
      return d;
    };
    if (raw?.mode === 'once') return { mode: 'once', ...(raw.at ? { at: date(raw.at, 'Lịch') } : {}) };
    if (raw?.mode === 'slots') {
      const slots = (Array.isArray(raw.slots) ? raw.slots : []).map((s: any) => ({ at: date(s?.at, 'Mốc'), ...(s?.postId ? { postId: String(s.postId) } : {}) }));
      if (!slots.length) throw new BadRequestException('Chọn ít nhất một mốc giờ');
      return { mode: 'slots', slots };
    }
    if (raw?.mode === 'interval') {
      const every = Math.max(1, Math.floor(Number(raw.every) || 1));
      const unit = ['minute', 'hour', 'day'].includes(raw.unit) ? raw.unit : 'hour';
      const count = raw.count === undefined || raw.count === null || raw.count === '' ? undefined : Math.max(1, Math.floor(Number(raw.count)));
      if (!isValidHours(raw.activeHours)) throw new BadRequestException('Khung giờ hoạt động dạng { from: "07:00", to: "23:00" }');
      return {
        mode: 'interval',
        startAt: raw.startAt ? date(raw.startAt, 'Bắt đầu') : new Date(),
        every,
        unit,
        ...(count ? { count } : {}),
        ...(raw.jitterMinutes ? { jitterMinutes: Math.min(120, Math.max(0, Math.floor(Number(raw.jitterMinutes)))) } : {}),
        ...(raw.activeHours ? { activeHours: { from: String(raw.activeHours.from), to: String(raw.activeHours.to) } } : {}),
      };
    }
    throw new BadRequestException('Lịch phải có mode: once / slots / interval');
  }

  /** Problems that block activation, and warnings (spam risk, posts not ready…). */
  async check(c: CampaignSpec): Promise<{ errors: string[]; warnings: string[] }> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const profiles = await this.profiles.list();
    const nameOf = (id: string) => profiles.find((p) => String(p._id) === id)?.name;
    c.destinations.forEach((d, i) => {
      const label = `Điểm đăng ${i + 1} (${PLATFORM_INFO[d.platform].label})`;
      const missing = d.profileIds.filter((id) => !nameOf(id));
      if (missing.length) errors.push(`${label}: có profile không còn tồn tại`);
      const sick = d.profileIds.filter((id) => (profiles.find((p) => String(p._id) === id) as { health?: { needsLogin?: boolean } } | undefined)?.health?.needsLogin);
      if (sick.length) warnings.push(`${label}: ${sick.map(nameOf).join(', ')} đang cần đăng nhập lại, sẽ bị bỏ qua`);
    });
    if (c.postSource.type === 'list') {
      const ids = [...new Set([...c.postSource.postIds, ...Object.values(c.postSource.separate ?? {}).flat(), ...(c.schedule.mode === 'slots' ? c.schedule.slots.map((s) => s.postId).filter((x): x is string => !!x) : [])])];
      if (!ids.length) errors.push('Chọn ít nhất một bài');
      const posts = await this.posts.find({ _id: { $in: ids } }).lean();
      if (posts.length !== ids.length) errors.push('Có bài không còn tồn tại');
      for (const p of posts) {
        if (p.status !== 'ready') warnings.push(`Bài "${p.title}" chưa ở trạng thái Sẵn sàng: sẽ bị bỏ qua lúc đăng`);
        const media = await this.media.getMany(p.mediaIds);
        for (const platform of new Set(c.destinations.map((d) => d.platform))) {
          const res = checkPostFor(platform, p, media);
          if (res.errors.length) errors.push(`Bài "${p.title}" không đăng được lên ${PLATFORM_INFO[platform].label}: ${res.errors.join('; ')}`);
        }
      }
      if (c.assignment === 'separate') {
        for (const d of c.destinations.filter((x) => x.accountMode === 'all')) {
          const without = d.profileIds.filter((id) => !c.postSource.type || !(c.postSource as { separate?: Record<string, string[]> }).separate?.[id]?.length);
          if (without.length) warnings.push(`Chưa có danh sách bài riêng cho ${without.map(nameOf).join(', ')}: dùng danh sách chung`);
        }
      }
    }
    if (c.schedule.mode === 'slots' && c.schedule.slots.some((s) => new Date(s.at).getTime() < Date.now() - MINUTE)) {
      errors.push('Có mốc giờ đã qua');
    }
    warnings.push(...this.spamWarnings(c, (id) => nameOf(id) ?? id));
    return { errors, warnings };
  }

  private spamWarnings(c: CampaignSpec, name: (id: string) => string): string[] {
    if (c.schedule.mode !== 'interval') return [];
    const step = c.schedule.every * UNIT_MIN[c.schedule.unit];
    const out: string[] = [];
    c.destinations.forEach((d, i) => {
      const label = `Điểm đăng ${i + 1}`;
      const n = d.profileIds.length;
      const perProfileEvery = d.accountMode === 'rotate' ? step * n : step;
      const perDay = Math.floor(1440 / perProfileEvery);
      if (perProfileEvery < d.limits.minGapPerProfileMinutes) {
        out.push(
          `${label}: mỗi ${fmtMin(step)} một bài với ${n} profile → mỗi profile ${fmtMin(perProfileEvery)} đăng 1 lần, ngắn hơn giới hạn ${fmtMin(d.limits.minGapPerProfileMinutes)}: nhiều lượt sẽ phải chờ. Thêm profile hoặc giãn lịch.`,
        );
      }
      if (perDay > d.limits.maxPerProfilePerDay && d.kind !== 'self') {
        out.push(`${label}: lịch này cần mỗi profile ~${perDay} bài/ngày, vượt giới hạn ${d.limits.maxPerProfilePerDay} bài/ngày.`);
      }
      if (d.accountMode === 'all' && n > 1 && (n - 1) * c.staggerMinutes >= step) {
        out.push(`${label}: giãn cách ${n} tài khoản (${fmtMin((n - 1) * c.staggerMinutes)}) dài hơn chu kỳ ${fmtMin(step)}, các mốc sẽ chồng lên nhau.`);
      }
      if (d.kind !== 'self' && d.accountMode === 'all' && n > 1) {
        out.push(`${label}: ${n} tài khoản cùng đăng vào một ${d.kind === 'group' ? 'nhóm' : 'Page'} mỗi mốc. Nên chọn "Xoay vòng" để tránh bị coi là spam.`);
      }
      if (d.profileIds.some((id) => !name(id))) out.push(`${label}: có profile không rõ`);
    });
    return out;
  }
}

const fmtMin = (m: number) => (m % 1440 === 0 ? `${m / 1440} ngày` : m % 60 === 0 ? `${m / 60} giờ` : `${m}′`);

export { OPEN_STATUSES };
