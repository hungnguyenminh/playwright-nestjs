/**
 * Selectors the publishers depend on. Sites change their UI, so each one has
 * a key, a purpose (told to the AI when it has to find a replacement), a
 * default, and how it can be checked without posting:
 * - scope 'page': on the destination page as it loads;
 * - scope 'composer': after opening the post composer (opening it is harmless);
 * - check 'visible' / 'attached' (file inputs are hidden).
 * Overrides (by the AI or by hand) are stored as versions in selector_versions.
 */
export interface SelectorSpec {
  key: string;
  platform: 'facebook' | 'threads';
  label: string;
  purpose: string;
  default: string;
  scope: 'page' | 'composer';
  check: 'visible' | 'attached';
  /** Only some destinations show it (e.g. "Join group" when not a member): not a failure when absent. */
  optional?: boolean;
  /** Kinds of destination the selector is used on. */
  kinds?: Array<'self' | 'page' | 'group'>;
}

export const SELECTORS: SelectorSpec[] = [
  {
    key: 'facebook.composer',
    platform: 'facebook',
    label: 'Nút mở khung soạn bài',
    purpose: 'The "write a post" box on a profile / Page / group that opens the post composer dialog when clicked (e.g. "Bạn đang nghĩ gì?", "Bạn viết gì đi...", "Write something...").',
    default: [
      'div[role=button]:has-text("Bạn đang nghĩ gì")',
      `div[role=button]:has-text("What's on your mind")`,
      'div[role=button]:has-text("Viết gì đó")',
      'div[role=button]:has-text("Write something")',
      'div[role=button]:has-text("Tạo bài viết công khai")',
      'div[role=button]:has-text("Create a public post")',
    ].join(', '),
    scope: 'page',
    check: 'visible',
  },
  {
    key: 'facebook.textbox',
    platform: 'facebook',
    label: 'Ô nhập nội dung trong khung soạn',
    purpose: 'The editable text area of the open composer dialog where the post text is typed.',
    default: 'div[role=dialog] div[contenteditable=true][role=textbox]',
    scope: 'composer',
    check: 'visible',
  },
  {
    key: 'facebook.fileInput',
    platform: 'facebook',
    label: 'Ô chọn ảnh / video trong khung soạn',
    purpose: 'The hidden <input type=file> of the open composer dialog that accepts images and videos.',
    default: 'div[role=dialog] input[type=file]',
    scope: 'composer',
    check: 'attached',
  },
  {
    key: 'facebook.post',
    platform: 'facebook',
    label: 'Nút Đăng trong khung soạn',
    purpose: 'The "Đăng" / "Post" button of the open composer dialog (only located, never clicked when checking).',
    default: 'div[role=dialog] div[role=button][aria-label="Đăng"], div[role=dialog] div[role=button][aria-label="Post"]',
    scope: 'composer',
    check: 'visible',
  },
  {
    key: 'facebook.close',
    platform: 'facebook',
    label: 'Nút đóng khung soạn',
    purpose: 'The close (X) button of the open composer dialog.',
    default: 'div[role=dialog] [aria-label="Đóng hộp thoại của công cụ tạo"], div[role=dialog] [aria-label="Close composer dialog"]',
    scope: 'composer',
    check: 'visible',
  },
  {
    key: 'facebook.privacy',
    platform: 'facebook',
    label: 'Nút chọn đối tượng (quyền riêng tư)',
    purpose: 'In the open composer on the own profile: the audience button under the author name ("Bạn bè", "Công khai"…) that opens the audience dialog.',
    default: 'div[role=dialog] div[role=button][aria-label^="Chỉnh sửa quyền riêng tư"], div[role=dialog] div[role=button][aria-label^="Edit privacy"]',
    scope: 'composer',
    check: 'visible',
    kinds: ['self'],
  },
  {
    key: 'facebook.join',
    platform: 'facebook',
    label: 'Nút "Tham gia nhóm" (để biết chưa là thành viên)',
    purpose: 'The "Tham gia nhóm" / "Join group" button shown on a group page when the account is not a member.',
    default: 'div[role=button]:has-text("Tham gia nhóm"), div[role=button]:has-text("Join group")',
    scope: 'page',
    check: 'visible',
    optional: true,
    kinds: ['group'],
  },
  {
    key: 'threads.compose',
    platform: 'threads',
    label: 'Nút tạo thread',
    purpose: 'The button that opens the new thread composer on threads.com.',
    default: `[aria-label="Tạo"], [aria-label="Create"], div[role=button]:has-text("Có gì mới"), div[role=button]:has-text("What's new")`,
    scope: 'page',
    check: 'visible',
  },
  {
    key: 'threads.box',
    platform: 'threads',
    label: 'Ô nhập nội dung thread',
    purpose: 'The editable text area of the open thread composer dialog.',
    default: 'div[role=dialog] div[contenteditable=true]',
    scope: 'composer',
    check: 'visible',
  },
  {
    key: 'threads.post',
    platform: 'threads',
    label: 'Nút Đăng thread',
    purpose: 'The "Đăng" / "Post" button of the open thread composer (only located, never clicked when checking).',
    default: 'div[role=dialog] div[role=button]:text-is("Đăng"), div[role=dialog] div[role=button]:text-is("Post")',
    scope: 'composer',
    check: 'visible',
  },
];

export const SELECTOR_BY_KEY = new Map(SELECTORS.map((s) => [s.key, s]));
export const DEFAULT_SELECTORS: Record<string, string> = Object.fromEntries(SELECTORS.map((s) => [s.key, s.default]));

/** Label marker that ties an action to the selector it uses: "Mở khung soạn ⟨facebook.composer⟩". */
export const selectorLabel = (text: string, key: string) => `${text} ⟨${key}⟩`;
export const keyFromLabel = (label?: string) => /⟨([\w.]+)⟩/.exec(label ?? '')?.[1];
