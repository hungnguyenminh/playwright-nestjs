import { checkPostFor, cleanPlatformOptions, composeText, detectFormat, type MediaLike, type PostLike } from './platforms.js';

const img = (n = 1): MediaLike[] => Array.from({ length: n }, (_, i) => ({ _id: `i${i}`, kind: 'image', width: 1080, height: 1080 }));
const video = (w: number, h: number, duration?: number): MediaLike => ({ _id: 'v', kind: 'video', width: w, height: h, duration });
const post = (over: Partial<PostLike> = {}): PostLike => ({ title: 'Bài', content: 'Xin chào', ...over });

describe('detectFormat', () => {
  it('guesses from the media', () => {
    expect(detectFormat('facebook', post(), [])).toBe('text');
    expect(detectFormat('facebook', post(), img())).toBe('photo');
    expect(detectFormat('facebook', post(), img(3))).toBe('album');
    expect(detectFormat('facebook', post(), [video(1080, 1920, 30)])).toBe('reel');
    expect(detectFormat('facebook', post(), [video(1080, 1920, 300)])).toBe('video');
    expect(detectFormat('facebook', post(), [video(1920, 1080, 30)])).toBe('video');
    expect(detectFormat('youtube', post(), [video(1080, 1920, 60)])).toBe('shorts');
    expect(detectFormat('youtube', post(), [video(1920, 1080, 60)])).toBe('video');
    expect(detectFormat('youtube', post(), img())).toBeNull();
    expect(detectFormat('tiktok', post(), img(2))).toBe('photo');
    expect(detectFormat('tiktok', post(), [video(1080, 1920, 10)])).toBe('video');
    expect(detectFormat('threads', post(), [])).toBe('text');
    expect(detectFormat('threads', post(), img())).toBe('media');
    expect(detectFormat('threads', post({ platforms: { threads: { parts: ['a', 'b'] } } }), [])).toBe('chain');
  });
});

describe('composeText', () => {
  it('adds link and hashtags once, uses per-platform overrides', () => {
    const p = post({ link: 'https://x.vn', hashtags: ['#sale', 'giá rẻ'], platforms: { tiktok: { caption: 'Cap #sale' } } });
    expect(composeText('facebook', p)).toBe('Xin chào\n\nhttps://x.vn\n\n#sale #giárẻ');
    expect(composeText('tiktok', p)).toBe('Cap #sale\n\n#giárẻ');
  });
});

describe('checkPostFor', () => {
  it('YouTube needs one video and a title of at most 100 characters', () => {
    expect(checkPostFor('youtube', post(), img()).errors).toContain('YouTube cần 1 video');
    const long = checkPostFor('youtube', post({ title: 'x'.repeat(101) }), [video(1920, 1080, 600)]);
    expect(long.format).toBe('video');
    expect(long.counts.title).toEqual({ used: 101, max: 100 });
    expect(long.errors).toEqual(['Tiêu đề dài 101 ký tự, tối đa 100']);
    expect(checkPostFor('youtube', post({ platforms: { youtube: { format: 'shorts' } } }), [video(1920, 1080, 600)]).errors).toEqual([
      'Shorts tối đa 3 phút',
      'Shorts cần video dọc hoặc vuông',
    ]);
  });

  it('TikTok photo posts need at least one image and no video', () => {
    expect(checkPostFor('tiktok', post({ platforms: { tiktok: { format: 'photo' } } }), []).errors).toContain('Bài ảnh TikTok cần ít nhất 1 ảnh');
    expect(checkPostFor('tiktok', post(), img(3))).toMatchObject({ format: 'photo', auto: true, errors: [] });
  });

  it('Threads chain: every part at most 500 characters', () => {
    const c = checkPostFor('threads', post({ platforms: { threads: { format: 'chain', parts: ['ok', 'y'.repeat(501), ' '] } } }), []);
    expect(c.format).toBe('chain');
    expect(c.counts).toEqual({ part1: { used: 2, max: 500 }, part2: { used: 501, max: 500 } });
    expect(c.errors).toEqual(['Đoạn 2 dài 501 ký tự, tối đa 500']);
    expect(checkPostFor('threads', post({ content: 'z'.repeat(600) }), []).errors).toEqual(['Nội dung dài 600 ký tự, tối đa 500']);
  });

  it('Facebook: chosen format must match the media', () => {
    expect(checkPostFor('facebook', post({ platforms: { facebook: { format: 'photo' } } }), img(2)).errors).toEqual(['Dạng "1 ảnh" cần đúng 1 ảnh']);
    expect(checkPostFor('facebook', post({ platforms: { facebook: { format: 'reel' } } }), [video(1080, 1920)]).warnings[0]).toContain('thời lượng');
    expect(checkPostFor('facebook', post(), img(2)).errors).toEqual([]);
  });
});

describe('cleanPlatformOptions', () => {
  it('keeps known platforms and typed options only', () => {
    expect(
      cleanPlatformOptions({
        facebook: { format: 'reel', privacy: ' public ', junk: 1, firstComment: '' },
        youtube: { tags: ['a', 2], madeForKids: 'yes', thumbnailId: 'bad' },
        myspace: { format: 'x' },
      }),
    ).toEqual({ facebook: { format: 'reel', privacy: 'public' }, youtube: { tags: ['a'] } });
  });
});
