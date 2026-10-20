import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { MediaService } from '../media/media.service.js';
import { checkPostFor, cleanPlatformOptions, PLATFORMS, type MediaLike, type Platform, type PostCheck } from '../publish/platforms.js';
import { BulkStatusDto, PostDto, PostQuery } from './post.dto.js';
import { Post, type PostStatus } from './post.schema.js';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cleanList = (l?: string[]) => [...new Set((l ?? []).map((s) => s.trim()).filter(Boolean))];

type PostShape = Pick<Post, 'title' | 'content' | 'hashtags' | 'link' | 'platforms'> & { mediaIds: unknown[] };

@Injectable()
export class PostsService {
  constructor(
    @InjectModel(Post.name) private readonly posts: Model<Post>,
    private readonly media: MediaService,
  ) {}

  /** Posts with a per-platform summary (format, errors) for the list. */
  async list(q: PostQuery) {
    const filter: QueryFilter<Post> = {};
    if (q.status) filter.status = { $in: q.status.split(',') as PostStatus[] };
    if (q.tag) filter.tags = q.tag;
    if (q.flowId) filter.flowId = new Types.ObjectId(q.flowId);
    if (q.q?.trim()) {
      const re = new RegExp(escapeRegex(q.q.trim()), 'i');
      filter.$or = [{ title: re }, { content: re }, { tags: re }];
    }
    const [items, total] = await Promise.all([
      this.posts
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      this.posts.countDocuments(filter),
    ]);
    const media = await this.media.getMany([...new Set(items.flatMap((p) => p.mediaIds.map(String)))]);
    const byId = new Map(media.map((m) => [String(m._id), m]));
    return {
      items: items.map((p) => {
        const own = p.mediaIds.map((id) => byId.get(String(id))).filter((m) => !!m);
        return { ...p, media: own, checks: this.checksFor(p, own) };
      }),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async tags() {
    return (await this.posts.distinct('tags')).filter(Boolean).sort();
  }

  async get(id: string) {
    const post = await this.posts.findById(id).lean();
    if (!post) throw new NotFoundException('Không tìm thấy bài viết');
    const media = await this.media.getMany(post.mediaIds);
    return { ...post, media, checks: this.checksFor(post, media) };
  }

  async create(dto: PostDto, extra: Partial<Post> = {}) {
    const doc = await this.toDoc(dto);
    await this.assertReady(doc, dto.status);
    const created = await this.posts.create({ ...doc, ...extra });
    return this.get(String(created._id));
  }

  async update(id: string, dto: PostDto) {
    const doc = await this.toDoc(dto);
    await this.assertReady(doc, dto.status);
    const res = await this.posts.updateOne({ _id: id }, doc);
    if (!res.matchedCount) throw new NotFoundException('Không tìm thấy bài viết');
    return this.get(id);
  }

  async duplicate(id: string) {
    const p = await this.posts.findById(id).lean();
    if (!p) throw new NotFoundException('Không tìm thấy bài viết');
    const { _id, createdAt: _c, updatedAt: _u, ...rest } = p as typeof p & { createdAt?: Date; updatedAt?: Date };
    const copy = await this.posts.create({
      ...rest,
      title: `${p.title} (bản sao)`,
      status: 'draft',
      usedCount: 0,
      lastPublishedAt: undefined,
      sourceRecords: [],
    });
    return this.get(String(copy._id));
  }

  async remove(id: string) {
    const res = await this.posts.deleteOne({ _id: id });
    if (!res.deletedCount) throw new NotFoundException('Không tìm thấy bài viết');
  }

  /** Sets the status of many posts; posts with errors can't become 'ready'. */
  async bulkStatus(dto: BulkStatusDto) {
    const failed: Array<{ id: string; title: string; errors: string[] }> = [];
    let ids = dto.ids;
    if (dto.status === 'ready') {
      const posts = await this.posts.find({ _id: { $in: dto.ids } }).lean();
      ids = [];
      for (const p of posts) {
        const errors = this.readyErrors(p, await this.media.getMany(p.mediaIds));
        if (errors.length) failed.push({ id: String(p._id), title: p.title, errors });
        else ids.push(String(p._id));
      }
    }
    await this.posts.updateMany({ _id: { $in: ids } }, { status: dto.status });
    return { updated: ids.length, failed };
  }

  /** Checks an unsaved post (the editor's live check). */
  async check(dto: PostDto, platforms?: Platform[]) {
    const doc = await this.toDoc(dto, false);
    const media = await this.media.getMany(doc.mediaIds);
    return this.checksFor(doc, media, platforms);
  }

  checksFor(post: PostShape, media: MediaLike[], platforms?: Platform[]): Partial<Record<Platform, PostCheck>> {
    const targets = platforms ?? PLATFORMS.filter((p) => post.platforms?.[p]);
    return Object.fromEntries(targets.map((p) => [p, checkPostFor(p, post, media)]));
  }

  private readyErrors(post: PostShape, media: MediaLike[]): string[] {
    const checks = Object.values(this.checksFor(post, media));
    if (!checks.length) return ['Chọn ít nhất một nền tảng để đăng'];
    return checks.flatMap((c) => c.errors.map((e) => `${c.platform}: ${e}`));
  }

  private async assertReady(doc: PostShape, status?: string) {
    if (status !== 'ready') return;
    const errors = this.readyErrors(doc, await this.media.getMany(doc.mediaIds));
    if (errors.length) throw new BadRequestException(`Bài chưa đăng được: ${errors.join('; ')}`);
  }

  private async toDoc(dto: PostDto, checkMedia = true) {
    const mediaIds = cleanList(dto.mediaIds).map((id) => new Types.ObjectId(id));
    if (checkMedia && mediaIds.length) {
      const found = await this.media.getMany(mediaIds);
      if (found.length !== mediaIds.length) throw new BadRequestException('Có media không còn tồn tại');
    }
    const link = dto.link?.trim();
    if (link && !/^https?:\/\/\S+$/i.test(link)) throw new BadRequestException('Link phải bắt đầu bằng http(s)://');
    return {
      title: dto.title.trim(),
      content: dto.content ?? '',
      hashtags: cleanList(dto.hashtags).map((t) => t.replace(/^#+/, '')),
      mediaIds,
      link: link || undefined,
      platforms: cleanPlatformOptions(dto.platforms),
      status: dto.status ?? 'draft',
      tags: cleanList(dto.tags),
    };
  }
}
