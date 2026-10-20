import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { errorMessage } from '../actions/handlers/handler.js';
import { Events, type TaskUpdatedEvent } from '../common/events.js';
import { JobsService } from '../jobs/jobs.service.js';
import { Task } from '../jobs/schemas.js';
import { MediaService } from '../media/media.service.js';
import { Post } from '../posts/post.schema.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { Publication, PublishCampaign } from './campaign.schema.js';
import { CampaignsService } from './campaigns.service.js';
import { SelectorsService } from './selectors.service.js';
import { destinationKey, type PickContext, pickProfile, postIndexFor, postListFor, shiftPlan } from './plan.js';
import { checkPostFor, PLATFORM_INFO, type PostFormat } from './platforms.js';
import { buildPublishJob, NEEDS_LOGIN, NOT_ALLOWED, type PublishInput } from './publishers.js';
import { DAY, MINUTE } from './time.js';

/** A publication later than this is overdue (catch-up rule applies). */
const GRACE_MS = 5 * MINUTE;
const DEFAULT_TICK_MS = 30_000;

type Pub = Publication & { _id: Types.ObjectId };
type Campaign = PublishCampaign & { _id: Types.ObjectId };

/**
 * Runs campaigns: every tick it moves the schedule after downtime, extends
 * endless schedules, and starts due publications (account and post chosen
 * now, so changes to the post library and account health count). Results come
 * back through TaskUpdated.
 */
@Injectable()
export class PublishSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PublishSchedulerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private readonly tickMs = Number(process.env.PUBLISH_TICK_MS) || DEFAULT_TICK_MS;

  constructor(
    private readonly campaignsService: CampaignsService,
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
    private readonly jobs: JobsService,
    private readonly profiles: ProfilesService,
    private readonly media: MediaService,
    private readonly selectors: SelectorsService,
  ) {}

  private get campaigns(): Model<PublishCampaign> {
    return this.campaignsService.campaigns;
  }
  private get publications(): Model<Publication> {
    return this.campaignsService.publications;
  }

  async onApplicationBootstrap() {
    // A publication that was running when the server stopped may or may not have been posted.
    const res = await this.publications.updateMany(
      { status: 'running' },
      { status: 'unknown', error: 'Máy chủ khởi động lại khi đang đăng: kiểm tra bài trên trang rồi chọn "Đã đăng" hoặc "Đăng lại"', finishedAt: new Date() },
    );
    if (res.modifiedCount) this.logger.warn(`${res.modifiedCount} publication(s) interrupted by a restart marked unknown`);
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    setTimeout(() => void this.tick(), 1_000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const active = (await this.campaigns.find({ status: 'active' }).lean()) as Campaign[];
      for (const c of active) {
        await this.catchUp(c, now);
        if (c.planCursor) await this.campaignsService.generate((await this.campaigns.findById(c._id).lean()) as Campaign, now);
      }
      const due = (await this.publications
        .find({ campaignId: { $in: active.map((c) => c._id) }, status: { $in: ['scheduled', 'waiting'] }, scheduledAt: { $lte: now } })
        .sort({ scheduledAt: 1, laneIndex: 1 })
        .limit(50)
        .lean()) as Pub[];
      for (const pub of due) {
        await this.run(pub, now).catch((err) => this.logger.error(`Publication ${pub._id}: ${errorMessage(err)}`));
      }
      await this.reconcile();
      for (const c of active) await this.finishIfDone(c._id);
    } catch (err) {
      this.logger.error(`Publish tick failed: ${errorMessage(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Overdue slots (machine off, paused…): shift the rest of the schedule, or skip them. */
  private async catchUp(c: Campaign, now: Date) {
    const overdue = await this.publications
      .findOne({ campaignId: c._id, status: 'scheduled', scheduledAt: { $lt: new Date(now.getTime() - GRACE_MS) } })
      .sort({ scheduledAt: 1 })
      .lean();
    if (!overdue) return;
    if (c.catchUp === 'skip') {
      const res = await this.publications.updateMany(
        { campaignId: c._id, status: 'scheduled', scheduledAt: { $lt: new Date(now.getTime() - GRACE_MS) } },
        { status: 'skipped', error: 'Quá giờ (máy tắt / tạm dừng), bỏ qua theo cài đặt', finishedAt: now },
      );
      this.campaignsService.addLog(c._id, `Bỏ qua ${res.modifiedCount} lượt quá giờ`);
      return;
    }
    await this.shiftFrom(c, overdue.scheduledAt, now, 'do máy tắt / bị gián đoạn');
  }

  /** Moves every scheduled publication from `from` on by (now − from), keeping their spacing. */
  private async shiftFrom(c: Campaign, from: Date, now: Date, why: string) {
    const items = (await this.publications.find({ campaignId: c._id, status: 'scheduled', scheduledAt: { $gte: from } }, { slot: 1, scheduledAt: 1 }).lean()).map(
      (p) => ({ id: String(p._id), slot: p.slot, scheduledAt: p.scheduledAt }),
    );
    const activeHours = c.schedule.mode === 'interval' ? c.schedule.activeHours : undefined;
    const { moves, delta } = shiftPlan(items, { now, from, activeHours, timezone: c.timezone });
    if (!moves.length) return;
    await this.publications.bulkWrite(moves.map((m) => ({ updateOne: { filter: { _id: m.id }, update: { scheduledAt: m.scheduledAt } } })));
    if (c.planCursor) {
      await this.campaigns.updateOne({ _id: c._id }, { 'planCursor.nextBaseAt': new Date(new Date(c.planCursor.nextBaseAt).getTime() + delta) });
    }
    this.campaignsService.addLog(c._id, `Dời lịch ${Math.round(delta / MINUTE)} phút ${why}`);
  }

  private async run(candidate: Pub, now: Date) {
    // Claim it so two ticks never start the same publication.
    const pub = (await this.publications.findOneAndUpdate(
      { _id: candidate._id, status: { $in: ['scheduled', 'waiting'] } },
      { status: 'running', startedAt: now },
      { returnDocument: 'after' },
    ).lean()) as Pub | null;
    if (!pub) return;
    const c = (await this.campaigns.findById(pub.campaignId).lean()) as Campaign | null;
    if (!c || c.status !== 'active') return this.setWaiting(pub, 'Chiến dịch không chạy');
    const dest = c.destinations[pub.destIndex];
    if (!dest) return this.finish(pub, 'skipped', { error: 'Điểm đăng đã bị xoá' });

    // 1. account
    const profiles = await this.profiles.list();
    const state: PickContext['state'] = {};
    for (const p of profiles) {
      const id = String(p._id);
      state[id] = { needsLogin: !!(p as { health?: { needsLogin?: boolean } }).health?.needsLogin, busy: p.inUse };
    }
    const candidates = dest.accountMode === 'all' ? [pub.lane] : dest.profileIds;
    const history = await this.history(candidates, now);
    const cursor = c.rotationCursors?.[pub.destIndex] ?? 0;
    const pick = pickProfile({
      now,
      destKey: destinationKey(dest, dest.accountMode === 'all' ? pub.lane : undefined),
      dest,
      laneProfileId: dest.accountMode === 'all' ? pub.lane : undefined,
      cursor,
      tried: pub.attempts.map((a) => String(a.profileId)),
      history: history.filter((h) => h.pubId !== String(pub._id)),
      minGapMinutes: c.minGapMinutes,
      state,
      seed: `${c._id}:${pub.destIndex}`,
    });
    if ('wait' in pick) {
      if (pub.attempts.length && pub.attempts.length >= dest.profileIds.length) {
        return this.finish(pub, 'failed', { error: `Đã thử ${pub.attempts.length} profile, đều lỗi: ${pub.attempts.at(-1)?.error ?? ''}` });
      }
      return this.setWaiting(pub, pick.wait);
    }
    const profileId = pick.profileId;
    const destKey = destinationKey(dest, profileId);
    // Facebook: a profile's personal page and its Pages share one session → one at a time.
    if (dest.platform === 'facebook' && (await this.publications.exists({ _id: { $ne: pub._id }, status: 'running', platform: 'facebook', profileId: new Types.ObjectId(profileId) }))) {
      return this.setWaiting(pub, 'Profile đang đăng một bài Facebook khác');
    }

    // 2. post
    const chosen = await this.pickPost(c, pub, dest.platform, destKey, profileId, now);
    if ('stop' in chosen) {
      await this.finish(pub, 'skipped', { error: chosen.stop });
      await this.publications.updateMany({ campaignId: c._id, status: 'scheduled' }, { status: 'skipped', error: chosen.stop, finishedAt: now });
      await this.campaigns.updateOne({ _id: c._id }, { planCursor: null });
      this.campaignsService.addLog(c._id, chosen.stop);
      return;
    }
    if ('wait' in chosen) return this.setWaiting(pub, chosen.wait);

    // A publication that waited (no account / no post) moves the rest of the schedule with it.
    if (now.getTime() - pub.scheduledAt.getTime() > GRACE_MS) {
      const next = await this.publications.findOne({ campaignId: c._id, status: 'scheduled', scheduledAt: { $gt: pub.scheduledAt } }).sort({ scheduledAt: 1 }).lean();
      if (next) await this.shiftFrom(c, next.scheduledAt, new Date(next.scheduledAt.getTime() + (now.getTime() - pub.scheduledAt.getTime())), 'vì lượt trước phải chờ');
    }

    // 3. job
    const input = await this.publishInput(chosen.post, dest, c.dryRun);
    const built = buildPublishJob(input);
    const profileName = profiles.find((p) => String(p._id) === profileId)?.name ?? '';
    const job = await this.jobs.create({
      name: `${c.name} · ${PLATFORM_INFO[dest.platform].label} · ${profileName}`,
      kind: 'publish',
      actions: built.actions,
      inputs: [{ name: chosen.post.title.slice(0, 80) }],
      vars: { __publish: { platform: dest.platform, kind: dest.kind, url: dest.url } },
      profileId,
      headless: c.headless,
      concurrency: 1,
      maxRetries: 0,
      stepTimeout: 60_000,
    });
    const task = await this.tasks.findOne({ jobId: job._id }, { _id: 1 }).lean();
    await this.publications.updateOne(
      { _id: pub._id },
      {
        profileId: new Types.ObjectId(profileId),
        destKey,
        postId: chosen.post._id,
        jobId: job._id,
        taskId: task?._id,
        $unset: { waitReason: 1 },
      },
    );
    if (dest.accountMode === 'rotate') {
      await this.campaigns.updateOne({ _id: c._id }, { [`rotationCursors.${pub.destIndex}`]: pick.cursor });
    }
    await this.campaignsService.emitPublication(pub._id);
  }

  /** Recent posts (and running ones) of these profiles, every campaign. */
  private async history(profileIds: string[], now: Date) {
    const recent = await this.publications
      .find({
        profileId: { $in: profileIds.map((id) => new Types.ObjectId(id)) },
        $or: [{ status: { $in: ['published', 'pending_approval', 'unknown'] }, finishedAt: { $gte: new Date(now.getTime() - 2 * DAY) } }, { status: 'running' }],
      })
      .lean();
    return recent.map((p) => ({
      pubId: String(p._id),
      profileId: String(p.profileId),
      destKey: p.destKey ?? '',
      at: p.finishedAt ?? p.startedAt ?? now,
      postId: p.postId ? String(p.postId) : undefined,
    }));
  }

  /** The post for this publication: pinned, from the list (order / assignment), or the oldest new one of a flow. */
  private async pickPost(c: Campaign, pub: Pub, platform: Pub['platform'], destKey: string, profileId: string, now: Date): Promise<{ post: Post & { _id: Types.ObjectId } } | { wait: string } | { stop: string }> {
    const dest = c.destinations[pub.destIndex];
    const usedHere = new Set(
      (
        await this.publications
          .find({ destKey, status: { $in: ['published', 'pending_approval', 'running'] }, _id: { $ne: pub._id }, startedAt: { $gte: new Date(now.getTime() - dest.limits.noRepeatPostDays * DAY) } }, { postId: 1 })
          .lean()
      ).map((p) => String(p.postId)),
    );
    const usable = async (id: string, why: string[]) => {
      const post = (await this.posts.findById(id).lean()) as (Post & { _id: Types.ObjectId }) | null;
      if (!post) return why.push('bài đã bị xoá'), null;
      if (post.status !== 'ready') return why.push(`"${post.title}" chưa sẵn sàng`), null;
      if (usedHere.has(id) && !pub.pinned) return why.push(`"${post.title}" vừa đăng ở đây trong ${dest.limits.noRepeatPostDays} ngày`), null;
      const res = checkPostFor(platform as never, post, await this.media.getMany(post.mediaIds));
      if (res.errors.length) return why.push(`"${post.title}": ${res.errors[0]}`), null;
      return post;
    };
    const why: string[] = [];
    if (pub.postId) {
      const post = await usable(String(pub.postId), why);
      return post ? { post } : { wait: `Bài đã chọn chưa đăng được: ${why.join('; ')}` };
    }
    if (c.postSource.type === 'flow') {
      const ready = await this.posts.find({ flowId: new Types.ObjectId(c.postSource.flowId), status: 'ready' }, { _id: 1 }).sort({ createdAt: 1 }).lean();
      for (const p of ready) {
        const post = await usable(String(p._id), why);
        if (post) return { post };
      }
      return c.whenExhausted === 'stop' ? { stop: 'Hết bài mới trong luồng, dừng chiến dịch' } : { wait: 'Chờ bài mới từ luồng' };
    }
    const list = postListFor(c as never, dest.accountMode === 'all' ? profileId : undefined);
    const start = postIndexFor({ _id: String(c._id), order: c.order, whenExhausted: c.whenExhausted, assignment: c.assignment }, pub.slot, pub.laneIndex, list.length);
    if (start === null) {
      return c.whenExhausted === 'stop' ? { stop: 'Đã đăng hết danh sách bài, dừng chiến dịch' } : { wait: 'Hết bài trong danh sách, chờ thêm bài' };
    }
    for (let k = 0; k < list.length; k++) {
      const post = await usable(list[(start + k) % list.length], why);
      if (post) return { post };
    }
    return { wait: `Không có bài nào đăng được: ${[...new Set(why)].slice(0, 3).join('; ')}` };
  }

  private async publishInput(post: Post & { _id: Types.ObjectId }, dest: Campaign['destinations'][number], dryRun: boolean): Promise<PublishInput> {
    const media = await this.media.getMany(post.mediaIds);
    const check = checkPostFor(dest.platform, post, media);
    const withPaths = await Promise.all(media.map(async (m) => ({ path: (await this.media.fileOf(String(m._id))).path, kind: m.kind })));
    const o = post.platforms?.[dest.platform] ?? {};
    const thumbId = (dest.platform === 'youtube' ? o.thumbnailId : dest.platform === 'tiktok' ? o.coverId : undefined) as string | undefined;
    return {
      platform: dest.platform,
      kind: dest.kind,
      url: dest.url,
      format: check.format as PostFormat,
      text: check.text,
      parts: o.parts?.filter((p) => p.trim()),
      title: o.title || post.title,
      options: o,
      media: dest.platform === 'youtube' ? withPaths.filter((m) => m.kind === 'video') : withPaths,
      thumbnailPath: thumbId ? (await this.media.fileOf(thumbId).catch(() => null))?.path : undefined,
      dryRun,
      selectors: await this.selectors.current(),
      fakeBase: process.env.PUBLISH_FAKE_URL || undefined,
    };
  }

  /** "Đăng thử": composes the post on the site with the account and stops before "Post". */
  async testJob(postId: string, target: { platform: Publication['platform']; kind: 'self' | 'page' | 'group'; url?: string; profileId: string }, headless = false) {
    const post = (await this.posts.findById(postId).lean()) as (Post & { _id: Types.ObjectId }) | null;
    if (!post) throw new NotFoundException('Không tìm thấy bài');
    const dest = { platform: target.platform as never, kind: target.kind, url: target.url, profileIds: [target.profileId], accountMode: 'all' as const, limits: { minGapPerProfileMinutes: 0, maxPerProfilePerDay: 99, noRepeatPostDays: 0 } };
    const input = await this.publishInput(post, dest, true);
    const built = buildPublishJob(input);
    return this.jobs.create({
      name: `Đăng thử · ${built.name}`,
      kind: 'publish',
      actions: built.actions,
      inputs: [{ name: post.title.slice(0, 80) }],
      vars: { __publish: { platform: target.platform, kind: target.kind, url: target.url } },
      profileId: target.profileId,
      headless,
      concurrency: 1,
      stepTimeout: 60_000,
    });
  }

  /** Running publications whose task already ended (event missed, e.g. finished before taskId was saved). */
  private async reconcile() {
    const running = await this.publications.find({ status: 'running', taskId: { $ne: null } }, { taskId: 1 }).lean();
    if (!running.length) return;
    const ended = await this.tasks
      .find({ _id: { $in: running.map((p) => p.taskId) }, status: { $in: ['done', 'failed', 'cancelled'] } }, { _id: 1, jobId: 1, status: 1 })
      .lean();
    for (const t of ended) await this.onTaskUpdated({ _id: String(t._id), jobId: String(t.jobId), status: t.status });
  }

  // ---- results -----------------------------------------------------------------------

  @OnEvent(Events.TaskUpdated, { async: true })
  async onTaskUpdated(e: TaskUpdatedEvent) {
    if (!['done', 'failed', 'cancelled'].includes(String(e.status))) return;
    const pub = (await this.publications.findOne({ taskId: new Types.ObjectId(e._id), status: 'running' }).lean()) as Pub | null;
    if (!pub) return;
    const task = await this.tasks.findById(e._id).lean();
    if (!task) return;
    const result = (task.result ?? {}) as { submitted?: boolean; postUrl?: string; pending?: boolean; dryRun?: boolean };
    const message = task.error?.message ?? '';

    if (task.status === 'done') {
      if (result.dryRun) return this.finish(pub, 'skipped', { error: 'Đăng thử: đã dừng trước nút Đăng' });
      await this.finish(pub, result.pending ? 'pending_approval' : 'published', { postUrl: result.postUrl });
      if (pub.postId) await this.posts.updateOne({ _id: pub.postId }, { $inc: { usedCount: 1 }, lastPublishedAt: new Date() });
      return;
    }
    if (result.submitted) {
      return this.finish(pub, 'unknown', { error: `Lỗi sau khi đã bấm Đăng (có thể đã đăng): ${message}` });
    }
    if (task.status === 'cancelled' && message !== 'Server restarted') return this.finish(pub, 'cancelled', { error: 'Đã huỷ task' });
    if (message.includes(NEEDS_LOGIN) && pub.profileId) await this.profiles.markNeedsLogin(String(pub.profileId), message);

    // Before "Post": try the next account of a rotating destination.
    const c = (await this.campaigns.findById(pub.campaignId).lean()) as Campaign | null;
    const dest = c?.destinations[pub.destIndex];
    const attempts = [...pub.attempts, { profileId: pub.profileId!, error: message.slice(0, 300), at: new Date() }];
    if (dest?.accountMode === 'rotate' && attempts.length < dest.profileIds.length) {
      await this.publications.updateOne(
        { _id: pub._id },
        { status: 'scheduled', attempts, scheduledAt: new Date(), $unset: { jobId: 1, taskId: 1, profileId: 1 } },
      );
      await this.campaignsService.emitPublication(pub._id);
      return;
    }
    const why = message.includes(NOT_ALLOWED) ? 'Không có quyền đăng' : message.includes(NEEDS_LOGIN) ? 'Profile cần đăng nhập lại' : 'Lỗi';
    await this.publications.updateOne({ _id: pub._id }, { attempts });
    await this.finish(pub, 'failed', { error: `${why}: ${message}` });
  }

  private async setWaiting(pub: Pub, reason: string) {
    await this.publications.updateOne({ _id: pub._id }, { status: 'waiting', waitReason: reason });
    await this.campaignsService.emitPublication(pub._id);
  }

  private async finish(pub: Pub, status: Publication['status'], set: { error?: string; postUrl?: string }) {
    await this.publications.updateOne({ _id: pub._id }, { status, finishedAt: new Date(), ...set });
    await this.campaignsService.emitPublication(pub._id);
  }

  private async finishIfDone(campaignId: Types.ObjectId) {
    const c = await this.campaigns.findById(campaignId, { planCursor: 1, status: 1 }).lean();
    if (!c || c.status !== 'active' || c.planCursor) return;
    if (await this.publications.exists({ campaignId, status: { $in: ['scheduled', 'waiting', 'running'] } })) return;
    await this.campaigns.updateOne({ _id: campaignId }, { status: 'done' });
    this.campaignsService.addLog(campaignId, 'Hoàn tất');
  }
}
