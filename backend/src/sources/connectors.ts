import type { Action, Condition } from '../actions/action.types.js';

/**
 * Data sources ("Nguồn"): each turns a list of links or keywords into one job
 * (built-in actions + one task per link / keyword). Items of a source are
 * stored in a list named after the source, so the Data page gets one dataset
 * per source ("website", "youtube"…), each item tagged with where it came from.
 */
export const SOURCE_TYPES = ['website', 'facebook', 'google', 'youtube', 'tiktok', 'threads', 'shopee'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface SourceSpec {
  type: SourceType;
  /** Links (website, facebook) or keywords (the others). */
  targets: string[];
  /** Website only: search each link for these keywords; none = read the link itself. */
  keywords?: string[];
  /** Items per link / keyword. */
  limit?: number;
  /** Open every item and read its page too (slower). */
  detail?: boolean;
  /** Chrome profile to run with (sites that need a login). */
  profileId?: string;
}

export interface SourceInfo {
  type: SourceType;
  label: string;
  /** What the user enters for this source. */
  target: 'link' | 'keyword';
  placeholder: string;
  /** Whether a logged-in profile is needed: always, often (blocks bots), never. */
  login: 'required' | 'recommended' | 'no';
  loginUrl?: string;
  note: string;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export const SOURCE_INFO: Record<SourceType, SourceInfo> = {
  website: {
    type: 'website',
    label: 'Website khác',
    target: 'link',
    placeholder: 'https://www.thegioididong.com/',
    login: 'no',
    note: 'Không có từ khoá: lấy danh sách (sản phẩm, bài viết…) hoặc nội dung ngay tại link. Có từ khoá: gõ vào ô tìm kiếm của trang rồi lấy kết quả.',
  },
  facebook: {
    type: 'facebook',
    label: 'Facebook group',
    target: 'link',
    placeholder: 'https://www.facebook.com/groups/…',
    login: 'required',
    loginUrl: 'https://www.facebook.com/',
    note: 'Lấy bài mới nhất trong group. Cần profile đã đăng nhập Facebook và là thành viên (với group kín).',
  },
  google: {
    type: 'google',
    label: 'Google',
    target: 'keyword',
    placeholder: 'điện thoại gập 2026',
    login: 'recommended',
    loginUrl: 'https://accounts.google.com/',
    note: 'Kết quả tìm kiếm (tiêu đề, link, mô tả), 10 kết quả mỗi trang. Google hay hỏi captcha với trình duyệt tự động: task sẽ tạm dừng để bạn giải trên live view.',
  },
  youtube: {
    type: 'youtube',
    label: 'YouTube',
    target: 'keyword',
    placeholder: 'review iphone 17',
    login: 'no',
    note: 'Video tìm được: tiêu đề, link, kênh, lượt xem, thời gian đăng, thời lượng.',
  },
  tiktok: {
    type: 'tiktok',
    label: 'TikTok',
    target: 'keyword',
    placeholder: 'review điện thoại',
    login: 'recommended',
    loginUrl: 'https://www.tiktok.com/login',
    note: 'Video tìm được. TikTok thường bắt kéo thanh trượt (captcha): task tạm dừng để bạn giải trên live view. Nên dùng profile đã đăng nhập.',
  },
  threads: {
    type: 'threads',
    label: 'Threads',
    target: 'keyword',
    placeholder: 'iphone',
    login: 'recommended',
    loginUrl: 'https://www.threads.com/login',
    note: 'Bài viết tìm được: tác giả, nội dung, link, thời gian. Không đăng nhập vẫn xem được một phần.',
  },
  shopee: {
    type: 'shopee',
    label: 'Shopee',
    target: 'keyword',
    placeholder: 'ốp lưng iphone',
    login: 'required',
    loginUrl: 'https://shopee.vn/buyer/login',
    note: 'Sản phẩm tìm được: tên, giá, link, ảnh. Shopee chặn trình duyệt chưa đăng nhập, cần profile đã đăng nhập Shopee.',
  },
};

/** Stops before reading when the site shows a captcha / login wall, so a person can deal with it. */
const blockedCheck = (when: Condition, message: string, after: Action[] = []): Action => ({
  type: 'if',
  label: 'Kiểm tra captcha / đăng nhập',
  condition: when,
  then: [{ type: 'pause', message }, { type: 'sleep', ms: 1_500 }, ...after],
});

const settle: Action = { type: 'sleep', ms: 1_500, jitter: 1_500 };

const shortLink = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 60);
  } catch {
    return url.slice(0, 60);
  }
};

const isLink = (s: string) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(s);

/** Cleans the user's list: trims, drops blanks and duplicates. */
export const cleanList = (list: string[] | undefined) => [...new Set((list ?? []).map((s) => s.trim()).filter(Boolean))];

/** Problems with a source, in Vietnamese, or [] when it can run. */
export function checkSource(spec: SourceSpec): string[] {
  const info = SOURCE_INFO[spec.type];
  if (!info) return [`Nguồn không hỗ trợ: ${spec.type}`];
  const targets = cleanList(spec.targets);
  const errors: string[] = [];
  if (!targets.length) errors.push(`${info.label}: nhập ít nhất một ${info.target === 'link' ? 'link' : 'từ khoá'}`);
  if (info.target === 'link') {
    const bad = targets.filter((t) => !isLink(t));
    if (bad.length) errors.push(`${info.label}: link không hợp lệ (cần http/https): ${bad.slice(0, 3).join(', ')}`);
    if (spec.type === 'facebook' && targets.some((t) => isLink(t) && !/facebook\.com\//i.test(t))) {
      errors.push('Facebook group: link phải là facebook.com/groups/…');
    }
  }
  if (spec.limit !== undefined && (spec.limit < 1 || spec.limit > MAX_LIMIT)) {
    errors.push(`${info.label}: số mục mỗi ${info.target === 'link' ? 'link' : 'từ khoá'} phải từ 1 đến ${MAX_LIMIT}`);
  }
  return errors;
}

export interface SourceJob {
  name: string;
  actions: Action[];
  inputs: Record<string, unknown>[];
  vars: Record<string, unknown>;
}

/** Builds the job (actions + one input per link / keyword) for a source. */
export function buildSourceJob(spec: SourceSpec): SourceJob {
  const info = SOURCE_INFO[spec.type];
  const limit = Math.min(Math.max(spec.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const detail = !!spec.detail;
  const targets = cleanList(spec.targets);
  const keywordInputs = () =>
    targets.map((keyword) => ({ name: keyword.slice(0, 60), keyword, q: encodeURIComponent(keyword) }));
  const as = spec.type;
  const extraKeyword = { source: spec.type, keyword: '{{keyword}}' };

  switch (spec.type) {
    case 'website': {
      const keywords = cleanList(spec.keywords);
      const inputs = targets.flatMap((url) =>
        (keywords.length ? keywords : ['']).map((keyword) => ({
          name: keyword ? `${shortLink(url)} · ${keyword}` : shortLink(url),
          url,
          keyword,
        })),
      );
      return {
        name: info.label,
        inputs,
        vars: {},
        actions: [
          { type: 'goto', url: '{{url}}', waitUntil: 'domcontentloaded' },
          settle,
          {
            type: 'if',
            label: 'Có từ khoá thì tìm trên trang, không thì đọc ngay link',
            condition: { var: 'keyword' },
            then: [
              { type: 'searchSite', query: '{{keyword}}' },
              { type: 'dismissOverlays', optional: true },
              // Search results are a list; no list = no results (not the page text).
              { type: 'extractAuto', mode: 'list', limit, detail, extra: { source: 'website', from: '{{url}}', keyword: '{{keyword}}' }, as },
            ],
            else: [
              { type: 'dismissOverlays', optional: true },
              { type: 'extractAuto', limit, detail, extra: { source: 'website', from: '{{url}}' }, as },
            ],
          },
        ],
      };
    }

    case 'facebook': {
      return {
        name: info.label,
        // Newest posts first instead of Facebook's "relevant" order.
        inputs: targets.map((url) => ({
          name: shortLink(url),
          url,
          feedUrl: /[?&]sorting_setting=/.test(url) ? url : `${url}${url.includes('?') ? '&' : '?'}sorting_setting=CHRONOLOGICAL`,
        })),
        vars: {},
        actions: [
          { type: 'goto', url: '{{feedUrl}}', waitUntil: 'domcontentloaded' },
          settle,
          blockedCheck(
            { any: [{ urlIncludes: '/login' }, { urlIncludes: '/checkpoint' }, { exists: 'form[action*="login"] input[name="email"]' }] },
            'Facebook cần đăng nhập. Chọn profile đã đăng nhập Facebook cho nguồn này, hoặc bấm Take control để đăng nhập ngay rồi Resume.',
            [{ type: 'goto', url: '{{feedUrl}}', waitUntil: 'domcontentloaded' }, settle],
          ),
          { type: 'waitFor', selector: 'div[role=feed]', timeout: 20_000, optional: true },
          {
            type: 'collect',
            selector: 'div[role=feed] > div',
            fields: {
              author: '[data-ad-rendering-role="profile_name"] a, [data-ad-rendering-role="profile_name"], h2 a, h3 a, strong a',
              text: '[data-ad-rendering-role="story_message"], [data-ad-comet-preview="message"], [data-ad-preview="message"]',
              url: { selector: 'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"], a[href*="/videos/"], a[href*="/reel/"]', get: 'href' },
              time: 'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]',
              image: { selector: 'img[src*="scontent"]:not([width="40"]):not([height="40"])', get: 'src' },
            },
            // The post date link only gets its real href when hovered.
            hover: 'a[role=link]',
            expand: true,
            required: ['author'],
            loadMore: false,
            limit,
            maxScrolls: Math.max(30, Math.ceil(limit / 2)),
            detail,
            extra: { source: 'facebook', group: '{{url}}' },
            as,
          },
        ],
      };
    }

    case 'google': {
      const pages = Array.from({ length: Math.ceil(limit / 10) }, (_, i) => i * 10);
      return {
        name: info.label,
        inputs: keywordInputs(),
        vars: { pages },
        actions: [
          {
            type: 'forEach',
            items: '{{pages}}',
            as: 'start',
            actions: [
              { type: 'goto', url: 'https://www.google.com/search?q={{q}}&hl=vi&start={{start}}', waitUntil: 'domcontentloaded' },
              blockedCheck(
                { any: [{ urlIncludes: '/sorry/' }, { exists: 'form#captcha-form, iframe[src*="recaptcha"]' }] },
                'Google yêu cầu xác minh (captcha). Bấm Take control để giải, xong bấm Resume.',
              ),
              { type: 'dismissOverlays', optional: true },
              {
                type: 'collect',
                selector: '#rso .MjjYud, #rso div.g, #rso [data-hveid]:has(> div a h3)',
                fields: {
                  title: 'h3',
                  url: { selector: 'a:has(h3)', get: 'href' },
                  snippet: '.VwiC3b, [data-sncf], [style*="-webkit-line-clamp"]',
                  site: 'cite',
                },
                required: ['title', 'url'],
                loadMore: false,
                maxScrolls: 0,
                limit: 10,
                append: true,
                detail,
                extra: extraKeyword,
                as,
              },
              { type: 'if', condition: { not: { exists: '#pnnext, a[aria-label="Trang tiếp theo"], a[aria-label="Next page"]' } }, then: [{ type: 'break' }] },
              { type: 'sleep', ms: 2_500, jitter: 2_500 },
            ],
          },
        ],
      };
    }

    case 'youtube': {
      return {
        name: info.label,
        inputs: keywordInputs(),
        vars: {},
        actions: [
          { type: 'goto', url: 'https://www.youtube.com/results?search_query={{q}}', waitUntil: 'domcontentloaded' },
          { type: 'dismissOverlays', optional: true },
          { type: 'waitFor', selector: 'ytd-video-renderer', timeout: 20_000, optional: true },
          {
            type: 'collect',
            selector: 'ytd-video-renderer',
            fields: {
              title: '#video-title',
              url: { selector: 'a#video-title', get: 'href' },
              channel: 'ytd-channel-name #text',
              channelUrl: { selector: 'ytd-channel-name a', get: 'href' },
              views: '#metadata-line span.inline-metadata-item:nth-of-type(1)',
              published: '#metadata-line span.inline-metadata-item:nth-of-type(2)',
              duration: 'badge-shape .yt-badge-shape__text, ytd-thumbnail-overlay-time-status-renderer #text',
              description: '.metadata-snippet-text',
              image: { selector: 'img', get: 'src' },
            },
            required: ['url'],
            loadMore: false,
            limit,
            detail,
            extra: extraKeyword,
            as,
          },
          {
            // Thumbnails load only when scrolled into view; they can be built from the video id.
            type: 'evaluate',
            label: 'Ảnh thumbnail theo id video',
            script:
              "return (vars.youtube || []).map((v) => { const id = /[?&]v=([\\w-]{6,})|\\/shorts\\/([\\w-]{6,})/.exec(v.url || ''); return v.image || !id ? v : { ...v, image: 'https://i.ytimg.com/vi/' + (id[1] || id[2]) + '/hqdefault.jpg' }; })",
            as,
          },
        ],
      };
    }

    case 'tiktok': {
      return {
        name: info.label,
        inputs: keywordInputs(),
        vars: {},
        actions: [
          { type: 'goto', url: 'https://www.tiktok.com/search/video?q={{q}}', waitUntil: 'domcontentloaded' },
          settle,
          blockedCheck(
            {
              any: [
                { exists: '#captcha-verify-container, .captcha_verify_container, [class*="captcha_verify"], [id*="captcha"]' },
                { textIncludes: { text: 'Kéo thanh trượt' } },
                { textIncludes: { text: 'Drag the slider' } },
                { exists: '[data-e2e="search-error-title"]' },
              ],
            },
            'TikTok yêu cầu xác minh (kéo thanh trượt) hoặc chặn tạm thời. Bấm Take control để giải / đăng nhập, xong bấm Resume.',
            [{ type: 'goto', url: 'https://www.tiktok.com/search/video?q={{q}}', waitUntil: 'domcontentloaded' }, settle],
          ),
          { type: 'dismissOverlays', optional: true },
          {
            type: 'collect',
            selector: '[data-e2e="search_video-item"], div[id^="grid-item-container"], div[id^="column-item-video-container"]',
            fields: {
              caption: '[data-e2e="search-card-video-caption"], [data-e2e="search-card-desc"]',
              url: { selector: 'a[href*="/video/"], a[href*="/photo/"]', get: 'href' },
              author: '[data-e2e="search-card-user-unique-id"]',
              views: '[data-e2e="video-views"]',
              published: '[class*="DivTimeTag"], [class*="TimeTag"]',
              image: { selector: 'img', get: 'src' },
            },
            required: ['url'],
            loadMore: false,
            limit,
            detail,
            extra: extraKeyword,
            as,
          },
        ],
      };
    }

    case 'threads': {
      return {
        name: info.label,
        inputs: keywordInputs(),
        vars: {},
        actions: [
          { type: 'goto', url: 'https://www.threads.com/search?q={{q}}&serp_type=default', waitUntil: 'domcontentloaded' },
          settle,
          blockedCheck(
            { urlIncludes: '/login' },
            'Threads cần đăng nhập. Bấm Take control để đăng nhập, xong bấm Resume.',
            [{ type: 'goto', url: 'https://www.threads.com/search?q={{q}}&serp_type=default', waitUntil: 'domcontentloaded' }, settle],
          ),
          { type: 'waitFor', selector: '[data-pressable-container=true]', timeout: 20_000, optional: true },
          {
            type: 'collect',
            selector: '[data-pressable-container=true]',
            fields: {
              author: 'a[href^="/@"] span[translate=no]',
              text: 'span[dir=auto]:not(a *):not(:has(a)):not(:has(time))',
              url: { selector: 'a[href*="/post/"]:has(time)', get: 'href' },
              time: { selector: 'time', get: 'attr:datetime' },
              image: { selector: 'picture img', get: 'src' },
            },
            required: ['url'],
            loadMore: false,
            limit,
            detail,
            extra: extraKeyword,
            as,
          },
        ],
      };
    }

    case 'shopee': {
      const search = 'https://shopee.vn/search?keyword={{q}}';
      return {
        name: info.label,
        inputs: keywordInputs(),
        vars: {},
        actions: [
          { type: 'goto', url: search, waitUntil: 'domcontentloaded' },
          settle,
          blockedCheck(
            { any: [{ urlIncludes: '/verify/' }, { urlIncludes: '/buyer/login' }, { urlIncludes: 'captcha' }] },
            'Shopee yêu cầu đăng nhập / xác minh. Dùng profile đã đăng nhập Shopee, hoặc bấm Take control để đăng nhập rồi Resume.',
            [{ type: 'goto', url: search, waitUntil: 'domcontentloaded' }, settle],
          ),
          { type: 'dismissOverlays', optional: true },
          { type: 'waitFor', selector: 'li[data-sqe="item"], li.shopee-search-item-result__item', timeout: 20_000, optional: true },
          {
            type: 'collect',
            selector: 'li[data-sqe="item"], li.shopee-search-item-result__item',
            auto: true,
            fields: {
              title: '[data-sqe="name"] > div, [data-sqe="name"], .line-clamp-2',
              url: { selector: 'a[href]', get: 'href' },
            },
            required: ['url'],
            loadMore: false,
            limit,
            detail,
            extra: extraKeyword,
            as,
          },
        ],
      };
    }
  }
}
