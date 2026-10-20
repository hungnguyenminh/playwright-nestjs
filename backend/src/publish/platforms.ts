/**
 * What each platform accepts: post formats, their media requirements and text
 * limits, plus the pure checks run before saving / scheduling a post. Limits
 * live in PLATFORM_INFO so a platform change is edited in one place.
 */
export const PLATFORMS = ['facebook', 'youtube', 'tiktok', 'threads'] as const;
export type Platform = (typeof PLATFORMS)[number];

export type FacebookFormat = 'text' | 'photo' | 'album' | 'video' | 'reel';
export type YoutubeFormat = 'video' | 'shorts';
export type TiktokFormat = 'video' | 'photo';
export type ThreadsFormat = 'text' | 'media' | 'chain';
export type PostFormat = FacebookFormat | YoutubeFormat | TiktokFormat | ThreadsFormat;

export interface MediaLike {
  _id: unknown;
  kind: 'image' | 'video';
  width?: number;
  height?: number;
  /** Seconds. */
  duration?: number;
}

export interface PlatformPostOptions {
  format?: 'auto' | PostFormat;
  content?: string;
  // facebook
  privacy?: string;
  firstComment?: string;
  // youtube
  title?: string;
  description?: string;
  tags?: string[];
  thumbnailId?: unknown;
  playlist?: string;
  madeForKids?: boolean;
  premiereAt?: Date | string;
  // tiktok
  caption?: string;
  coverId?: unknown;
  allowComment?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  // threads
  parts?: string[];
  topic?: string;
  replyControl?: string;
}

export interface PostLike {
  title: string;
  content: string;
  hashtags?: string[];
  link?: string;
  mediaIds?: unknown[];
  platforms?: Partial<Record<Platform, PlatformPostOptions>>;
}

interface FormatInfo {
  value: PostFormat;
  label: string;
  hint: string;
}

export interface PlatformInfo {
  platform: Platform;
  label: string;
  formats: FormatInfo[];
  /** Characters of the main text (caption / description). */
  textMax: number;
  options: Record<string, { label: string; values?: Array<{ value: string; label: string }> }>;
  limits: Record<string, number>;
}

export const PLATFORM_INFO: Record<Platform, PlatformInfo> = {
  facebook: {
    platform: 'facebook',
    label: 'Facebook',
    formats: [
      { value: 'text', label: 'Chữ', hint: 'Không có media (có thể kèm link)' },
      { value: 'photo', label: '1 ảnh', hint: 'Đúng 1 ảnh' },
      { value: 'album', label: 'Nhiều ảnh (album)', hint: 'Từ 2 ảnh, có thể lẫn video' },
      { value: 'video', label: 'Video', hint: 'Đúng 1 video' },
      { value: 'reel', label: 'Reels', hint: '1 video dọc, tối đa 90 giây' },
    ],
    textMax: 63_206,
    options: {
      privacy: {
        label: 'Ai xem được (trang cá nhân)',
        values: [
          { value: 'public', label: 'Công khai' },
          { value: 'friends', label: 'Bạn bè' },
          { value: 'only_me', label: 'Chỉ mình tôi' },
        ],
      },
      firstComment: { label: 'Bình luận đầu tiên (vd để link ở comment)' },
    },
    limits: { reelMaxSeconds: 90, albumMaxItems: 80, commentMax: 8_000 },
  },
  youtube: {
    platform: 'youtube',
    label: 'YouTube',
    formats: [
      { value: 'video', label: 'Video', hint: '1 video' },
      { value: 'shorts', label: 'Shorts', hint: '1 video dọc hoặc vuông, tối đa 3 phút' },
    ],
    textMax: 5_000,
    options: {
      privacy: {
        label: 'Chế độ hiển thị',
        values: [
          { value: 'public', label: 'Công khai' },
          { value: 'unlisted', label: 'Không công khai' },
          { value: 'private', label: 'Riêng tư' },
        ],
      },
    },
    limits: { titleMax: 100, tagsTotalMax: 500, shortsMaxSeconds: 180 },
  },
  tiktok: {
    platform: 'tiktok',
    label: 'TikTok',
    formats: [
      { value: 'video', label: 'Video', hint: '1 video' },
      { value: 'photo', label: 'Ảnh (carousel)', hint: '1–35 ảnh, không video' },
    ],
    textMax: 2_200,
    options: {
      privacy: {
        label: 'Ai được xem',
        values: [
          { value: 'public', label: 'Mọi người' },
          { value: 'friends', label: 'Bạn bè' },
          { value: 'only_me', label: 'Chỉ mình tôi' },
        ],
      },
    },
    limits: { photoMax: 35, videoMaxSeconds: 3_600 },
  },
  threads: {
    platform: 'threads',
    label: 'Threads',
    formats: [
      { value: 'text', label: 'Chữ', hint: 'Không media' },
      { value: 'media', label: 'Ảnh / video', hint: '1–20 ảnh hoặc video' },
      { value: 'chain', label: 'Chuỗi thread', hint: 'Nhiều đoạn nối nhau, mỗi đoạn tối đa 500 ký tự' },
    ],
    textMax: 500,
    options: {
      replyControl: {
        label: 'Ai được trả lời',
        values: [
          { value: 'everyone', label: 'Mọi người' },
          { value: 'followers', label: 'Người theo dõi' },
          { value: 'following', label: 'Người bạn theo dõi' },
          { value: 'mentioned', label: 'Người được nhắc đến' },
        ],
      },
      topic: { label: 'Chủ đề (topic)' },
    },
    limits: { mediaMax: 20, partMax: 500, videoMaxSeconds: 300 },
  },
};

const isVertical = (m: MediaLike) => !!m.width && !!m.height && m.height >= m.width;

/** Format for 'auto': from the attached media (no media = text, short vertical video = Reels / Shorts…). */
export function detectFormat(platform: Platform, post: PostLike, media: MediaLike[]): PostFormat | null {
  const videos = media.filter((m) => m.kind === 'video');
  const images = media.filter((m) => m.kind === 'image');
  const v = videos[0];
  switch (platform) {
    case 'facebook':
      if (!media.length) return 'text';
      if (media.length > 1) return 'album';
      if (images.length) return 'photo';
      return isVertical(v) && (v.duration ?? Infinity) <= PLATFORM_INFO.facebook.limits.reelMaxSeconds ? 'reel' : 'video';
    case 'youtube':
      if (!v) return null;
      return isVertical(v) && (v.duration ?? Infinity) <= PLATFORM_INFO.youtube.limits.shortsMaxSeconds ? 'shorts' : 'video';
    case 'tiktok':
      if (v) return 'video';
      return images.length ? 'photo' : null;
    case 'threads':
      if ((post.platforms?.threads?.parts ?? []).filter((p) => p.trim()).length > 1) return 'chain';
      return media.length ? 'media' : 'text';
  }
}

/** Main text as it will be posted: per-platform override or shared content, plus link and hashtags. */
export function composeText(platform: Platform, post: PostLike): string {
  const o = post.platforms?.[platform] ?? {};
  const body =
    (platform === 'tiktok' ? o.caption : platform === 'youtube' ? o.description : o.content) || post.content || '';
  const extras: string[] = [];
  if (post.link && !body.includes(post.link) && platform !== 'tiktok') extras.push(post.link);
  const tags = (post.hashtags ?? [])
    .map((t) => t.trim().replace(/^#*/, ''))
    .filter(Boolean)
    .map((t) => `#${t.replace(/\s+/g, '')}`)
    .filter((t) => !body.includes(t));
  if (tags.length) extras.push(tags.join(' '));
  return [body.trim(), ...extras].filter(Boolean).join('\n\n');
}

export interface PostCheck {
  platform: Platform;
  format: PostFormat | null;
  /** Format was guessed from the media ('auto'). */
  auto: boolean;
  text: string;
  counts: Record<string, { used: number; max: number }>;
  errors: string[];
  warnings: string[];
}

/** Checks a post for one platform in the chosen (or guessed) format. */
export function checkPostFor(platform: Platform, post: PostLike, media: MediaLike[]): PostCheck {
  const info = PLATFORM_INFO[platform];
  const o = post.platforms?.[platform] ?? {};
  const chosen = o.format && o.format !== 'auto' ? o.format : null;
  const format = chosen ?? detectFormat(platform, post, media);
  const text = composeText(platform, post);
  const errors: string[] = [];
  const warnings: string[] = [];
  const counts: PostCheck['counts'] = {};
  const videos = media.filter((m) => m.kind === 'video');
  const images = media.filter((m) => m.kind === 'image');
  const label = info.formats.find((f) => f.value === format)?.label ?? format;
  const count = (key: string, used: number, max: number, what: string) => {
    counts[key] = { used, max };
    if (used > max) errors.push(`${what} dài ${used} ký tự, tối đa ${max}`);
  };
  const unknownLength = (v?: MediaLike) => v && v.duration === undefined;

  if (chosen && !info.formats.some((f) => f.value === chosen)) errors.push(`${info.label} không có dạng "${chosen}"`);
  if (!format) {
    errors.push(platform === 'tiktok' ? 'TikTok cần 1 video hoặc ít nhất 1 ảnh' : `${info.label} cần 1 video`);
  }

  switch (platform) {
    case 'facebook':
      count('text', text.length, info.textMax, 'Nội dung');
      if (o.firstComment) count('firstComment', o.firstComment.length, info.limits.commentMax, 'Bình luận đầu tiên');
      if (format === 'text' && media.length) errors.push('Dạng "Chữ" không đăng kèm media');
      if (format === 'text' && !text.trim()) errors.push('Bài chữ cần có nội dung');
      if (format === 'photo' && (images.length !== 1 || videos.length)) errors.push('Dạng "1 ảnh" cần đúng 1 ảnh');
      if (format === 'album' && media.length < 2) errors.push('Album cần ít nhất 2 ảnh / video');
      if (format === 'album' && media.length > info.limits.albumMaxItems) errors.push(`Album tối đa ${info.limits.albumMaxItems} mục`);
      if ((format === 'video' || format === 'reel') && (videos.length !== 1 || images.length)) errors.push(`Dạng "${label}" cần đúng 1 video`);
      if (format === 'reel' && videos[0]) {
        if ((videos[0].duration ?? 0) > info.limits.reelMaxSeconds) errors.push(`Reels tối đa ${info.limits.reelMaxSeconds} giây`);
        if (!isVertical(videos[0]) && videos[0].width) warnings.push('Reels nên là video dọc (9:16)');
        if (unknownLength(videos[0])) warnings.push('Không đọc được thời lượng video, hãy chắc là ≤ 90 giây');
      }
      break;

    case 'youtube': {
      const title = (o.title || post.title || '').trim();
      count('title', title.length, info.limits.titleMax, 'Tiêu đề');
      count('text', text.length, info.textMax, 'Mô tả');
      if (!title) errors.push('YouTube cần tiêu đề');
      if (/[<>]/.test(title + text)) errors.push('YouTube không cho dùng ký tự < hoặc > trong tiêu đề / mô tả');
      const tagsTotal = (o.tags ?? []).join(',').length;
      count('tags', tagsTotal, info.limits.tagsTotalMax, 'Tags');
      if (format && (videos.length !== 1 || images.length)) errors.push('YouTube cần đúng 1 video (ảnh chỉ dùng làm thumbnail)');
      if (format === 'shorts' && videos[0]) {
        if ((videos[0].duration ?? 0) > info.limits.shortsMaxSeconds) errors.push('Shorts tối đa 3 phút');
        if (videos[0].width && !isVertical(videos[0])) errors.push('Shorts cần video dọc hoặc vuông');
        if (unknownLength(videos[0])) warnings.push('Không đọc được thời lượng video, hãy chắc là ≤ 3 phút');
      }
      if (o.premiereAt && new Date(o.premiereAt).getTime() < Date.now()) errors.push('Giờ công chiếu phải ở tương lai');
      break;
    }

    case 'tiktok':
      count('text', text.length, format === 'photo' ? 4_000 : info.textMax, 'Caption');
      if (format === 'video' && (videos.length !== 1 || images.length)) errors.push('TikTok video cần đúng 1 video');
      if (format === 'photo') {
        if (videos.length) errors.push('Bài ảnh TikTok không kèm video');
        if (!images.length) errors.push('Bài ảnh TikTok cần ít nhất 1 ảnh');
        if (images.length > info.limits.photoMax) errors.push(`Bài ảnh TikTok tối đa ${info.limits.photoMax} ảnh`);
      }
      if (videos[0] && (videos[0].duration ?? 0) > info.limits.videoMaxSeconds) errors.push('Video TikTok tối đa 60 phút');
      break;

    case 'threads': {
      const parts = format === 'chain' ? (o.parts ?? []).map((p) => p.trim()).filter(Boolean) : [text];
      if (format === 'chain') {
        if (parts.length < 2) errors.push('Chuỗi thread cần ít nhất 2 đoạn');
        parts.forEach((p, i) => {
          counts[`part${i + 1}`] = { used: p.length, max: info.limits.partMax };
          if (p.length > info.limits.partMax) errors.push(`Đoạn ${i + 1} dài ${p.length} ký tự, tối đa ${info.limits.partMax}`);
        });
      } else {
        count('text', text.length, info.textMax, 'Nội dung');
      }
      if (format === 'text' && media.length) errors.push('Dạng "Chữ" không kèm media');
      if (format === 'text' && !text.trim()) errors.push('Bài chữ cần có nội dung');
      if (format === 'media' && !media.length) errors.push('Dạng "Ảnh / video" cần ít nhất 1 ảnh hoặc video');
      if (media.length > info.limits.mediaMax) errors.push(`Threads tối đa ${info.limits.mediaMax} ảnh / video`);
      for (const v of videos) if ((v.duration ?? 0) > info.limits.videoMaxSeconds) errors.push('Video Threads tối đa 5 phút');
      break;
    }
  }
  return { platform, format, auto: !chosen, text, counts, errors, warnings };
}

const STRING_OPTS = ['format', 'content', 'privacy', 'firstComment', 'title', 'description', 'playlist', 'caption', 'topic', 'replyControl'];
const STRING_LIST_OPTS = ['tags', 'parts'];
const BOOL_OPTS = ['madeForKids', 'allowComment', 'allowDuet', 'allowStitch'];
const ID_OPTS = ['thumbnailId', 'coverId'];

/** Keeps known platforms and option keys with the right types; empty strings are dropped. */
export function cleanPlatformOptions(raw: unknown): Partial<Record<Platform, PlatformPostOptions>> {
  const out: Partial<Record<Platform, PlatformPostOptions>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const p of PLATFORMS) {
    const src = (raw as Record<string, unknown>)[p];
    if (!src || typeof src !== 'object') continue;
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      if (STRING_OPTS.includes(k) && typeof v === 'string' && v.trim()) o[k] = k === 'content' || k === 'description' || k === 'caption' ? v : v.trim();
      else if (STRING_LIST_OPTS.includes(k) && Array.isArray(v)) o[k] = v.filter((x) => typeof x === 'string').map(String);
      else if (BOOL_OPTS.includes(k) && typeof v === 'boolean') o[k] = v;
      else if (ID_OPTS.includes(k) && typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v)) o[k] = v;
      else if (k === 'premiereAt' && (typeof v === 'string' || v instanceof Date) && !Number.isNaN(new Date(v).getTime())) o[k] = new Date(v);
    }
    out[p] = o as PlatformPostOptions;
  }
  return out;
}
