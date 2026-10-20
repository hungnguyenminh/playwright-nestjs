import type { Action, Condition } from '../actions/action.types.js';
import type { Platform, PlatformPostOptions, PostFormat } from './platforms.js';
import { DEFAULT_SELECTORS, selectorLabel } from './selectors.js';

/**
 * Turns one publication (platform, destination, post) into a job: a list of
 * actions run with the chosen profile, like sources/connectors.ts does for
 * crawling. Shared rules:
 * - stop with NEEDS_LOGIN / NOT_ALLOWED when the account can't post (the
 *   scheduler then tries the next account);
 * - `submitted` is output right before pressing "Post": a failure after that
 *   is never retried automatically (it may have been posted);
 * - dryRun pauses right before "Post" so the user can look at it in the live view.
 *
 * The real platform publishers drive the websites' current UI and have not
 * been verified against live accounts yet; selectors live here to be fixed
 * in one place.
 */
export interface PublishInput {
  platform: Platform;
  kind: 'self' | 'page' | 'group';
  url?: string;
  format: PostFormat;
  /** Composed text (shared content / override + link + hashtags). */
  text: string;
  /** Threads chain parts. */
  parts?: string[];
  title?: string;
  options: PlatformPostOptions;
  media: Array<{ path: string; kind: 'image' | 'video' }>;
  thumbnailPath?: string;
  dryRun?: boolean;
  /** Current selector overrides by key (see selectors.ts); missing keys use the defaults. */
  selectors?: Record<string, string>;
  /** Test publisher page (PUBLISH_FAKE_URL); never set in normal use. */
  fakeBase?: string;
}

export const NEEDS_LOGIN = 'NEEDS_LOGIN';
export const NOT_ALLOWED = 'NOT_ALLOWED';

const fail = (code: string, message: string, when: Condition): Action => ({
  type: 'if',
  label: message,
  condition: when,
  then: [{ type: 'evaluate', script: `throw new Error(${JSON.stringify(`${code}: ${message}`)})` }],
});
/**
 * Dry run: screenshot of the composed post, wait for Resume, then `discard`
 * (empty the composer so no draft is left) and stop without posting.
 */
const pause = (dryRun: boolean | undefined, where: string, discard: Action[] = []): Action[] =>
  dryRun
    ? [
        { type: 'evaluate', script: 'return true', as: 'dryRun' },
        { type: 'screenshot', name: 'dang-thu' },
        { type: 'pause', message: `Đăng thử: bài đã soạn xong trên ${where}, CHƯA bấm Đăng. Xem trên live view rồi bấm Resume để huỷ bản nháp và kết thúc (không đăng).` },
        ...discard,
        { type: 'stop', message: 'Đăng thử xong, đã huỷ bản nháp, không đăng' },
      ]
    : [];
const submitted: Action = { type: 'evaluate', label: 'Đánh dấu: bắt đầu bấm Đăng', script: 'return true', as: 'submitted' };
const wait = (ms: number): Action => ({ type: 'sleep', ms, jitter: Math.round(ms / 2) });
const files = (input: PublishInput) => input.media.map((m) => m.path);

export function buildPublishJob(input: PublishInput): { name: string; actions: Action[] } {
  if (input.fakeBase) return { name: `Đăng (giả lập) · ${input.platform}`, actions: fakePublisher(input) };
  switch (input.platform) {
    case 'facebook':
      return { name: 'Đăng Facebook', actions: facebook(input) };
    case 'threads':
      return { name: 'Đăng Threads', actions: threads(input) };
    case 'tiktok':
      return { name: 'Đăng TikTok', actions: tiktok(input) };
    case 'youtube':
      return { name: 'Đăng YouTube', actions: youtube(input) };
  }
}

/** Local test page: a form with #content, #media, #submit; shows #post-url or #pending. */
function fakePublisher(input: PublishInput): Action[] {
  const q = new URLSearchParams({ platform: input.platform, kind: input.kind, format: input.format, url: input.url ?? '' });
  return [
    { type: 'goto', url: `${input.fakeBase}/compose?${q}` },
    fail(NEEDS_LOGIN, 'Profile cần đăng nhập lại', { exists: '#login' }),
    fail(NOT_ALLOWED, 'Không có quyền đăng ở đây', { exists: '#not-allowed' }),
    { type: 'fill', selector: '#content', value: input.text },
    ...(input.media.length ? [{ type: 'upload', selector: '#media', files: files(input) } as Action] : []),
    ...pause(input.dryRun, 'trang giả lập'),
    submitted,
    { type: 'click', selector: '#submit' },
    { type: 'waitFor', selector: '#done' },
    { type: 'extract', selector: '#post-url', get: 'attr:href', as: 'postUrl', optional: true },
    { type: 'if', condition: { exists: '#pending' }, then: [{ type: 'evaluate', script: 'return true', as: 'pending' }] },
  ];
}

// ---- Facebook -------------------------------------------------------------------

/** Current selector for a key: the stored override (AI / user) or the default. */
const sel = (input: PublishInput, key: string) => input.selectors?.[key] ?? DEFAULT_SELECTORS[key];

/** Fixed selectors (not in the versioned registry). */
const FB = {
  discardConfirm: 'div[role=dialog] div[role=button]:text-is("Bỏ"), div[role=dialog] div[role=button]:text-is("Bỏ bài viết"), div[role=dialog] div[role=button]:text-is("Discard")',
  // Audience dialog "Đối tượng của bài viết" (checked 2026-10-19): each option is a <label> with a
  // radio input and its name in a span; "Đặt làm đối tượng mặc định" is a checkbox, ticked by default.
  privacyOption: {
    public: ['Công khai', 'Public'],
    friends: ['Bạn bè', 'Friends'],
    only_me: ['Chỉ mình tôi', 'Only me'],
  } as Record<string, string[]>,
  privacyDone: 'div[role=dialog] div[role=button][aria-label="Xong"], div[role=dialog] div[role=button][aria-label="Done"]',
  switchToPage: 'div[role=button]:has-text("Chuyển ngay"), div[role=button]:has-text("Switch now"), div[role=button][aria-label="Chuyển"]',
};

function facebook(input: PublishInput): Action[] {
  const S = (key: string) => sel(input, `facebook.${key}`);
  const L = (text: string, key: string) => selectorLabel(text, `facebook.${key}`);
  const target = input.kind === 'self' ? 'https://www.facebook.com/me' : input.url!;
  const where = input.kind === 'self' ? 'trang cá nhân' : input.kind === 'page' ? 'Page' : 'nhóm';
  return [
    { type: 'goto', url: target },
    wait(2_500),
    fail(NEEDS_LOGIN, 'Facebook yêu cầu đăng nhập lại', { any: [{ urlIncludes: '/login' }, { urlIncludes: '/checkpoint' }, { exists: 'form[action*="login"] input[name="email"]' }] }),
    ...(input.kind === 'page'
      ? [
          // New Pages: act as the Page first.
          { type: 'click', selector: FB.switchToPage, optional: true, timeout: 5_000 } as Action,
          wait(2_000),
          { type: 'goto', url: target } as Action,
          wait(2_000),
        ]
      : []),
    ...(input.kind === 'group' ? [fail(NOT_ALLOWED, 'Profile chưa là thành viên nhóm', { exists: S('join') })] : []),
    { type: 'click', label: L('Mở khung soạn', 'composer'), selector: S('composer'), timeout: 20_000 },
    { type: 'waitFor', label: L('Chờ ô nhập nội dung', 'textbox'), selector: S('textbox'), timeout: 20_000 },
    { type: 'click', label: L('Bấm vào ô nhập', 'textbox'), selector: S('textbox') },
    { type: 'type', text: input.text, delay: 15 },
    ...(input.media.length ? [{ type: 'upload', label: L('Đính kèm ảnh / video', 'fileInput'), selector: S('fileInput'), files: files(input) } as Action, wait(3_000 * input.media.length)] : []),
    // Audience of this post only (own profile): the "make it the default" box is unticked first, and
    // the run stops (before "Post") if it can't be, so the account's default audience never changes.
    ...(input.kind === 'self' && input.options.privacy && FB.privacyOption[input.options.privacy]
      ? [
          { type: 'click', label: L('Mở chọn đối tượng', 'privacy'), selector: S('privacy'), timeout: 10_000 } as Action,
          { type: 'waitFor', selector: 'div[role=dialog] input[type=radio]', state: 'attached', timeout: 10_000 } as Action,
          wait(800),
          {
            type: 'click',
            selector: FB.privacyOption[input.options.privacy].map((t) => `div[role=dialog] label:has(input[type=radio]):has(span:text-is("${t}"))`).join(', '),
            timeout: 10_000,
          } as Action,
          wait(600),
          {
            type: 'evaluate',
            label: 'Bỏ tích "Đặt làm đối tượng mặc định"',
            script:
              "const box = document.querySelector('div[role=dialog] input[type=checkbox][value=default_privacy_checkbox]'); if (box && box.checked) box.click(); await new Promise((r) => setTimeout(r, 500)); if (box && box.checked) throw new Error('Không bỏ được ô \"Đặt làm đối tượng mặc định\": dừng để không đổi đối tượng mặc định của tài khoản'); return box ? 'đã bỏ tích' : 'không có ô mặc định';",
          } as Action,
          { type: 'click', selector: FB.privacyDone, timeout: 5_000 } as Action,
          wait(1_200),
        ]
      : []),
    ...pause(input.dryRun, `Facebook (${where})`, [
      { type: 'click', selector: S('textbox'), optional: true },
      { type: 'press', key: 'Control+A' },
      { type: 'press', key: 'Backspace' },
      { type: 'click', selector: S('close'), timeout: 5_000, optional: true },
      wait(1_200),
      { type: 'click', selector: FB.discardConfirm, timeout: 3_000, optional: true },
    ]),
    submitted,
    { type: 'click', label: L('Bấm Đăng', 'post'), selector: S('post'), timeout: 30_000 },
    { type: 'waitFor', selector: S('textbox'), state: 'detached', timeout: 180_000 },
    wait(3_000),
    {
      type: 'if',
      condition: { any: [{ textIncludes: { text: 'chờ phê duyệt' } }, { textIncludes: { text: 'đang chờ duyệt' } }, { textIncludes: { text: 'pending' } }] },
      then: [{ type: 'evaluate', script: 'return true', as: 'pending' }],
    },
  ];
}

// ---- Threads ----------------------------------------------------------------------

function threads(input: PublishInput): Action[] {
  const box = sel(input, 'threads.box');
  const parts = input.format === 'chain' && input.parts?.length ? input.parts : [input.text];
  return [
    { type: 'goto', url: 'https://www.threads.com/' },
    wait(2_500),
    fail(NEEDS_LOGIN, 'Threads yêu cầu đăng nhập lại', { any: [{ urlIncludes: '/login' }, { exists: 'input[name="username"]' }] }),
    { type: 'click', label: selectorLabel('Mở khung tạo thread', 'threads.compose'), selector: sel(input, 'threads.compose'), timeout: 20_000 },
    { type: 'waitFor', label: selectorLabel('Chờ ô nhập', 'threads.box'), selector: box, timeout: 20_000 },
    { type: 'click', selector: box },
    { type: 'type', text: parts[0], delay: 15 },
    ...(input.media.length ? [{ type: 'upload', selector: 'div[role=dialog] input[type=file]', files: files(input) } as Action, wait(3_000 * input.media.length)] : []),
    ...parts.slice(1).flatMap((part): Action[] => [
      { type: 'click', selector: 'div[role=dialog] :text("Thêm vào thread"), div[role=dialog] :text("Add to thread")' },
      wait(800),
      { type: 'click', selector: `${box} >> nth=-1` },
      { type: 'type', text: part, delay: 15 },
    ]),
    ...pause(input.dryRun, 'Threads'),
    submitted,
    { type: 'click', label: selectorLabel('Bấm Đăng', 'threads.post'), selector: sel(input, 'threads.post') },
    { type: 'waitFor', selector: box, state: 'detached', timeout: 180_000 },
  ];
}

// ---- TikTok -----------------------------------------------------------------------

function tiktok(input: PublishInput): Action[] {
  const caption = 'div[contenteditable=true]';
  return [
    { type: 'goto', url: 'https://www.tiktok.com/tiktokstudio/upload' },
    wait(3_000),
    fail(NEEDS_LOGIN, 'TikTok yêu cầu đăng nhập lại', { urlIncludes: '/login' }),
    { type: 'upload', selector: 'input[type=file]', files: files(input) },
    { type: 'waitFor', selector: caption, timeout: 300_000 },
    wait(5_000),
    { type: 'click', selector: caption },
    { type: 'press', key: 'Control+A' },
    { type: 'press', key: 'Backspace' },
    { type: 'type', text: input.text, delay: 15 },
    ...pause(input.dryRun, 'TikTok'),
    submitted,
    { type: 'click', selector: 'button[data-e2e="post_video_button"], button:has-text("Đăng"), button:has-text("Post")', timeout: 300_000 },
    { type: 'waitFor', url: '**/tiktokstudio/content**', timeout: 300_000, optional: true },
  ];
}

// ---- YouTube ----------------------------------------------------------------------

function youtube(input: PublishInput): Action[] {
  const o = input.options;
  const privacy = ({ public: 'PUBLIC', unlisted: 'UNLISTED', private: 'PRIVATE' } as Record<string, string>)[o.privacy ?? 'public'] ?? 'PUBLIC';
  return [
    { type: 'goto', url: 'https://studio.youtube.com/' },
    wait(3_000),
    fail(NEEDS_LOGIN, 'YouTube yêu cầu đăng nhập lại', { urlIncludes: 'accounts.google.com' }),
    { type: 'click', selector: '#create-icon, ytcp-button#create-icon', timeout: 20_000 },
    { type: 'click', selector: 'tp-yt-paper-item#text-item-0' },
    { type: 'upload', selector: 'input[type=file]', files: files(input) },
    { type: 'waitFor', selector: '#title-textarea #textbox', timeout: 120_000 },
    wait(2_000),
    { type: 'click', selector: '#title-textarea #textbox' },
    { type: 'press', key: 'Control+A' },
    { type: 'type', text: input.title ?? '', delay: 15 },
    { type: 'click', selector: '#description-textarea #textbox' },
    { type: 'type', text: input.text, delay: 10 },
    ...(input.thumbnailPath ? [{ type: 'upload', selector: 'input#file-loader', files: [input.thumbnailPath], optional: true } as Action] : []),
    { type: 'click', selector: `tp-yt-paper-radio-button[name="${o.madeForKids ? 'VIDEO_MADE_FOR_KIDS_MFK' : 'VIDEO_MADE_FOR_KIDS_NOT_MFK'}"]` },
    { type: 'repeat', times: 3, actions: [{ type: 'click', selector: '#next-button' }, wait(1_500)] },
    { type: 'click', selector: `tp-yt-paper-radio-button[name="${privacy}"]` },
    { type: 'extract', selector: '.video-url-fadeable a, a.ytcp-video-info', get: 'attr:href', as: 'postUrl', optional: true },
    ...pause(input.dryRun, 'YouTube Studio'),
    submitted,
    { type: 'click', selector: '#done-button' },
    { type: 'waitFor', selector: 'ytcp-uploads-still-processing-dialog, ytcp-video-share-dialog', timeout: 600_000, optional: true },
  ];
}
