import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { imageSize, parseMoov, videoInfo } from './media-info.js';

const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8);
  head.write(type, 4, 'ascii');
  return Buffer.concat([head, body]);
};

/** mvhd v0 (timescale, duration) and a video tkhd v0 with an optional 90° rotation. */
function moov(seconds: number, w: number, h: number, rotate90 = false) {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  const tkhd = Buffer.alloc(84);
  const m = 40;
  // matrix [a b u; c d v; x y w], 16.16 fixed point
  tkhd.writeInt32BE(rotate90 ? 0 : 0x10000, m);
  tkhd.writeInt32BE(rotate90 ? 0x10000 : 0, m + 4);
  tkhd.writeInt32BE(rotate90 ? -0x10000 : 0, m + 12);
  tkhd.writeInt32BE(rotate90 ? 0 : 0x10000, m + 16);
  tkhd.writeUInt32BE(w * 65536, m + 36);
  tkhd.writeUInt32BE(h * 65536, m + 40);
  const audio = box('trak', box('tkhd', Buffer.alloc(84)));
  return box('moov', box('mvhd', mvhd), audio, box('trak', box('tkhd', tkhd)));
}

describe('media info', () => {
  it('reads PNG / JPEG / WebP sizes from real Chrome screenshots', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 321, height: 123 } });
      await page.setContent('<body style="background:red">x</body>');
      expect(imageSize(await page.screenshot({ type: 'png' }))).toEqual({ width: 321, height: 123 });
      expect(imageSize(await page.screenshot({ type: 'jpeg' }))).toEqual({ width: 321, height: 123 });
      const webp = await page.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 50;
        c.height = 70;
        const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/webp'));
        return [...new Uint8Array(await blob.arrayBuffer())];
      });
      expect(imageSize(Buffer.from(webp))).toEqual({ width: 50, height: 70 });
      expect(imageSize(Buffer.from('not an image'))).toEqual({});
    } finally {
      await browser.close();
    }
  });

  it('reads MP4 duration and display size, applying rotation', async () => {
    expect(parseMoov(moov(42, 1920, 1080).subarray(8))).toEqual({ duration: 42, width: 1920, height: 1080 });
    expect(parseMoov(moov(15, 1920, 1080, true).subarray(8))).toEqual({ duration: 15, width: 1080, height: 1920 });
    // moov after a big mdat, as phones write it
    const dir = mkdtempSync(join(tmpdir(), 'media-'));
    const file = join(dir, 'v.mp4');
    writeFileSync(file, Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('mdat', Buffer.alloc(200_000)), moov(7, 720, 1280)]));
    expect(await videoInfo(file)).toEqual({ duration: 7, width: 720, height: 1280 });
  });
});
