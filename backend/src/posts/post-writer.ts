import type Anthropic from '@anthropic-ai/sdk';
import { checkPostFor, PLATFORM_INFO, type Platform } from '../publish/platforms.js';

/**
 * AI post writing (pure parts): the tool the model fills, the prompts, and the
 * checks a written post must pass before it is saved. The model only gets the
 * data rows: it must not invent facts (prices, dates, places) that aren't there.
 */
export type WriteMode = 'perRecord' | 'digest';

export interface WriteOptions {
  platforms: Platform[];
  mode: WriteMode;
  /** Rows per post in digest mode (e.g. "top 5 today"). */
  digestSize?: number;
  /** User's own instructions ("viết review ngắn, giọng vui…"). */
  prompt?: string;
  tone?: string;
  length?: 'short' | 'medium' | 'long';
  language?: string;
}

export interface WrittenPost {
  title: string;
  content: string;
  hashtags: string[];
  /** Positions (0-based) of the rows the post was written from. */
  source_indexes: number[];
}

export const WRITE_TOOL: Anthropic.Beta.BetaTool = {
  name: 'save_posts',
  description: 'Save the social media posts written from the data rows. Call exactly once with every post.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['posts'],
    properties: {
      posts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'content', 'hashtags', 'source_indexes'],
          properties: {
            title: { type: 'string', description: 'Short internal name of the post (not published)' },
            content: { type: 'string', description: 'The post text, plain text only (no markdown, no **bold**), line breaks allowed, no hashtags inside' },
            hashtags: { type: 'array', items: { type: 'string' }, description: '0-6 hashtags without the # sign' },
            source_indexes: { type: 'array', items: { type: 'integer' }, description: 'Indexes of the data rows this post uses' },
          },
        },
      },
    },
  },
};

const LENGTH: Record<NonNullable<WriteOptions['length']>, string> = {
  short: '2–4 câu (dưới ~400 ký tự)',
  medium: 'khoảng 4–8 câu (dưới ~900 ký tự)',
  long: 'chi tiết, nhiều đoạn (dưới ~2000 ký tự)',
};

/** Characters the post text (content + hashtags) may use on every chosen platform. */
export function textBudget(platforms: Platform[]): number {
  return Math.min(...platforms.map((p) => PLATFORM_INFO[p].textMax), 63_206);
}

export function systemPrompt(o: WriteOptions): string {
  const budget = textBudget(o.platforms);
  return [
    'Bạn là người viết nội dung mạng xã hội cho một doanh nghiệp / cá nhân Việt Nam.',
    'Bạn nhận các dòng dữ liệu (sản phẩm, bài viết, video… mà công cụ đã thu thập) và viết bài đăng từ đó.',
    '',
    'Quy tắc bắt buộc:',
    '- Chỉ dùng thông tin có trong dữ liệu. Không bịa giá, ngày, địa điểm, khuyến mãi, số liệu hay lời trích dẫn.',
    '- Văn bản thuần: KHÔNG dùng markdown (không **, __, #tiêu đề, gạch đầu dòng markdown). Mạng xã hội hiển thị nguyên văn các ký tự đó. Có thể xuống dòng và dùng emoji vừa phải.',
    '- Hashtag để riêng trong trường hashtags, không viết vào content.',
    `- content + hashtags phải dưới ${budget} ký tự (giới hạn của ${o.platforms.map((p) => PLATFORM_INFO[p].label).join(', ')}).`,
    '- Nếu có link nguồn trong dữ liệu và phù hợp, có thể nhắc tới nhưng không bắt buộc.',
    `- Ngôn ngữ: ${o.language || 'tiếng Việt'}. Độ dài: ${LENGTH[o.length ?? 'medium']}.${o.tone ? ` Giọng văn: ${o.tone}.` : ''}`,
    o.mode === 'digest'
      ? `- Chế độ tổng hợp: mỗi bài gộp ${o.digestSize ?? 5} dòng liên tiếp (vd "Top 5 …"); source_indexes liệt kê các dòng của bài đó.`
      : '- Mỗi dòng dữ liệu thành đúng một bài; source_indexes = [vị trí dòng đó].',
    '',
    'Viết xong thì gọi tool save_posts đúng một lần với toàn bộ bài.',
  ].join('\n');
}

/** Long values are cut so a batch of rows fits comfortably in one request. */
const clipValue = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 600 ? `${s.slice(0, 600)}…` : s;
};

export function userMessage(rows: Array<Record<string, unknown>>, o: WriteOptions): string {
  const data = rows.map((r, i) => `<row index="${i}">\n${Object.entries(r)
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}: ${clipValue(v)}`)
    .join('\n')}\n</row>`);
  const expected = o.mode === 'digest' ? Math.ceil(rows.length / Math.max(1, o.digestSize ?? 5)) : rows.length;
  return [
    `<data>\n${data.join('\n')}\n</data>`,
    o.prompt?.trim() ? `<request>\n${o.prompt.trim()}\n</request>` : '',
    `Viết ${expected} bài.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Problems with the written posts, to send back to the model (empty = all good). */
export function checkWritten(posts: WrittenPost[], rowCount: number, o: WriteOptions): string[] {
  const errors: string[] = [];
  const expected = o.mode === 'digest' ? Math.ceil(rowCount / Math.max(1, o.digestSize ?? 5)) : rowCount;
  if (posts.length !== expected) errors.push(`Cần đúng ${expected} bài, nhận được ${posts.length}.`);
  posts.forEach((p, i) => {
    const label = `Bài ${i + 1}`;
    if (!p.content.trim()) errors.push(`${label}: content trống.`);
    if (/\*\*|__|^#{1,6}\s/m.test(p.content)) errors.push(`${label}: có markdown (**, __, #), hãy viết văn bản thuần.`);
    if (!p.source_indexes.length || p.source_indexes.some((x) => x < 0 || x >= rowCount)) errors.push(`${label}: source_indexes không hợp lệ.`);
    for (const platform of o.platforms) {
      const res = checkPostFor(platform, { title: p.title, content: p.content, hashtags: p.hashtags, platforms: { [platform]: {} } }, []);
      // Video-only platforms are reported separately (AI posts have no video).
      const textErrors = res.errors.filter((e) => /ký tự|Nội dung|Caption|Mô tả|Tiêu đề/.test(e));
      textErrors.forEach((e) => errors.push(`${label} (${PLATFORM_INFO[platform].label}): ${e}`));
    }
  });
  return errors;
}

/** Platforms AI posts can't go to on their own (they need a video; TikTok also takes photo posts). */
export const VIDEO_ONLY: Platform[] = ['youtube'];
