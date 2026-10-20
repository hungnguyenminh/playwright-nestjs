/**
 * Facebook destinations: a Page or a Group link (empty = the account's own
 * profile). Post / event / video / share links are refused.
 */
export type FacebookTarget = { kind: 'page' | 'group'; url: string; slug: string } | { error: string };

const REFUSED: Array<[RegExp, string]> = [
  [/^\/groups\/[^/]+\/(posts|permalink|user|media|events|announcements|members|about)\b/i, 'link bài viết / mục trong nhóm, hãy dùng link của chính nhóm'],
  [/^\/(events|watch|marketplace|reel|reels|stories|share|photo|photos|videos|gaming|live|hashtag|search|login|notifications|messages|friends|bookmarks|saved|ads|business)\b/i, 'không phải link Page hoặc Group'],
  [/^\/(story|permalink|photo|video|sharer|share)\.php/i, 'link bài viết, hãy dùng link Page hoặc Group'],
  [/\/(posts|videos|photos|reel|permalink)\//i, 'link bài viết, hãy dùng link Page hoặc Group'],
];

export function parseFacebookUrl(raw: string): FacebookTarget {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return { error: 'Link không hợp lệ' };
  }
  const host = u.hostname.toLowerCase();
  if (!/^((www|m|web|mbasic|touch)\.)?(facebook\.com|fb\.com)$/.test(host)) return { error: 'Không phải link Facebook' };
  const path = u.pathname.replace(/\/+$/, '') || '/';
  for (const [re, why] of REFUSED) if (re.test(path)) return { error: `Không nhận: ${why}` };

  const group = /^\/groups\/([^/]+)$/i.exec(path);
  if (group) {
    return { kind: 'group', slug: group[1], url: `https://www.facebook.com/groups/${group[1]}` };
  }
  if (path === '/profile.php') {
    const id = u.searchParams.get('id');
    if (!id || !/^\d+$/.test(id)) return { error: 'Link profile.php thiếu id' };
    return { kind: 'page', slug: id, url: `https://www.facebook.com/profile.php?id=${id}` };
  }
  const pages = /^\/pages\/([^/]+)\/(\d+)$/i.exec(path);
  if (pages) return { kind: 'page', slug: pages[2], url: `https://www.facebook.com/${pages[2]}` };
  const page = /^\/([A-Za-z0-9.\-_]{2,})$/.exec(path);
  if (page && !/^(home|me|profile|groups|pages|settings|help|policies|privacy)$/i.test(page[1])) {
    return { kind: 'page', slug: page[1], url: `https://www.facebook.com/${page[1]}` };
  }
  return { error: 'Chỉ nhận link Page (facebook.com/<tên>) hoặc Group (facebook.com/groups/<tên>)' };
}
