import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Model, Types } from 'mongoose';
import { appConfig, type AppConfig } from '../config/app.config.js';
import { imageSize, MediaInfo, videoInfo } from './media-info.js';
import { Media, MediaKind } from './media.schema.js';

/** Fields of a file received by multer (no @types/multer in this project). */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
}

const EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};
const kindOf = (mime: string): MediaKind | null =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : null;

/** Image download timeout for /media/from-url. */
const FETCH_TIMEOUT_MS = 30_000;

@Injectable()
export class MediaService {
  readonly dir: string;

  constructor(
    @InjectModel(Media.name) private readonly media: Model<Media>,
    @Inject(appConfig.KEY) private readonly config: AppConfig,
  ) {
    this.dir = join(config.storageDir, 'media');
  }

  list(kind?: string) {
    return this.media
      .find(kind === 'image' || kind === 'video' ? { kind } : {})
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
  }

  async get(id: string) {
    const m = await this.media.findById(id).lean();
    if (!m) throw new NotFoundException('Không tìm thấy media');
    return m;
  }

  /** Media documents in the given order (missing ids are dropped). */
  async getMany(ids: unknown[]) {
    const docs = await this.media.find({ _id: { $in: ids } }).lean();
    return ids.map((id) => docs.find((d) => String(d._id) === String(id))).filter((d) => !!d);
  }

  async fileOf(id: string) {
    const m = await this.media.findById(id).select('+path').lean();
    if (!m) throw new NotFoundException('Không tìm thấy media');
    return m;
  }

  /** Moves an uploaded temp file into the media folder and records it. */
  async fromUpload(file: UploadedFileLike, hint: MediaInfo = {}) {
    const kind = kindOf(file.mimetype);
    if (!kind) {
      await rm(file.path, { force: true });
      throw new BadRequestException('Chỉ nhận ảnh hoặc video');
    }
    const _id = new Types.ObjectId();
    const path = join(this.dir, `${_id}${EXT[file.mimetype] ?? (extname(file.originalname) || '.bin')}`);
    await mkdir(this.dir, { recursive: true });
    await rename(file.path, path);
    const info = kind === 'image' ? imageSize(await readFile(path)) : await videoInfo(path);
    return this.save({
      _id,
      name: file.originalname,
      mime: file.mimetype,
      kind,
      size: file.size,
      path,
      ...dropEmpty(hint),
      ...dropEmpty(info),
    });
  }

  /** Downloads an image (e.g. a record's `image`) into the media library. */
  async fromUrl(url: string) {
    if (!/^https?:\/\//i.test(url)) throw new BadRequestException('Link phải bắt đầu bằng http(s)://');
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'user-agent': 'Mozilla/5.0' } });
    } catch (err) {
      throw new BadRequestException(`Không tải được: ${(err as Error).message}`);
    }
    if (!res.ok) throw new BadRequestException(`Không tải được: HTTP ${res.status}`);
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (kindOf(mime) !== 'image') throw new BadRequestException(`Link không phải ảnh (${mime || 'không rõ loại'})`);
    const max = this.config.mediaMaxMb * 1024 * 1024;
    if (Number(res.headers.get('content-length') ?? 0) > max) throw new BadRequestException('Ảnh quá lớn');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new BadRequestException('Ảnh quá lớn');
    const _id = new Types.ObjectId();
    const path = join(this.dir, `${_id}${EXT[mime] ?? '.img'}`);
    await mkdir(this.dir, { recursive: true });
    await writeFile(path, buf);
    let name = 'image';
    try {
      name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image').slice(0, 120) || 'image';
    } catch {
      /* keep default */
    }
    return this.save({ _id, name, mime, kind: 'image', size: buf.length, path, sourceUrl: url, ...imageSize(buf) });
  }

  async remove(id: string) {
    const m = await this.fileOf(id);
    await this.media.deleteOne({ _id: id });
    await rm(m.path, { force: true });
  }

  private async save(doc: Partial<Media> & { _id: Types.ObjectId; path: string }) {
    const created = await this.media.create(doc);
    const { path: _path, ...rest } = created.toObject();
    return rest;
  }
}

const dropEmpty = (o: MediaInfo) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0));
