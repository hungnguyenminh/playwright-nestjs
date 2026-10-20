import { open } from 'node:fs/promises';

/**
 * Size / length of media files without extra dependencies: image headers
 * (PNG, JPEG, GIF, WebP) and the MP4 / MOV "moov" box (duration, display size,
 * rotation). Enough to guess the post format (vertical short video → Reels /
 * Shorts…).
 */
export interface MediaInfo {
  width?: number;
  height?: number;
  /** Seconds. */
  duration?: number;
}

export function imageSize(buf: Buffer): MediaInfo {
  // PNG: IHDR right after the signature.
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // WebP: lossy (VP8), lossless (VP8L), extended (VP8X)
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  // JPEG: walk the segments to a SOFn marker.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return {};
}

/** Parses a "moov" box: duration from mvhd, size (rotation applied) from the first video tkhd. */
export function parseMoov(moov: Buffer): MediaInfo {
  const out: MediaInfo = {};
  const boxes = (buf: Buffer, start: number, end: number, visit: (type: string, from: number, to: number) => void) => {
    let i = start;
    while (i + 8 <= end) {
      let size = buf.readUInt32BE(i);
      const type = buf.toString('ascii', i + 4, i + 8);
      let header = 8;
      if (size === 1 && i + 16 <= end) {
        size = Number(buf.readBigUInt64BE(i + 8));
        header = 16;
      } else if (size === 0) size = end - i;
      if (size < header || i + size > end) break;
      visit(type, i + header, i + size);
      i += size;
    }
  };
  boxes(moov, 0, moov.length, (type, from, to) => {
    if (type === 'mvhd') {
      const v1 = moov[from] === 1;
      const timescale = moov.readUInt32BE(from + (v1 ? 20 : 12));
      const duration = v1 ? Number(moov.readBigUInt64BE(from + 24)) : moov.readUInt32BE(from + 16);
      if (timescale) out.duration = Math.round((duration / timescale) * 100) / 100;
    }
    if (type === 'trak' && !out.width) {
      boxes(moov, from, to, (t, f) => {
        if (t !== 'tkhd') return;
        const v1 = moov[f] === 1;
        const matrix = f + (v1 ? 52 : 40);
        const w = moov.readUInt32BE(matrix + 36) / 65536;
        const h = moov.readUInt32BE(matrix + 40) / 65536;
        if (!w || !h) return; // audio track
        // A 90° / 270° rotation matrix has a = 0, b = ±1.
        const rotated = moov.readInt32BE(matrix) === 0 && moov.readInt32BE(matrix + 4) !== 0;
        out.width = Math.round(rotated ? h : w);
        out.height = Math.round(rotated ? w : h);
      });
    }
  });
  return out;
}

/** Reads a video file's top-level boxes to find "moov" (often at the end), without loading the whole file. */
export async function videoInfo(path: string): Promise<MediaInfo> {
  const fh = await open(path, 'r');
  try {
    const { size: fileSize } = await fh.stat();
    const head = Buffer.alloc(16);
    let pos = 0;
    while (pos + 8 <= fileSize) {
      await fh.read(head, 0, 16, pos);
      let size = head.readUInt32BE(0);
      const type = head.toString('ascii', 4, 8);
      let header = 8;
      if (size === 1) {
        size = Number(head.readBigUInt64BE(8));
        header = 16;
      } else if (size === 0) size = fileSize - pos;
      if (size < 8) break;
      if (type === 'moov') {
        if (size > 64 * 1024 * 1024) return {};
        const moov = Buffer.alloc(size - header);
        await fh.read(moov, 0, moov.length, pos + header);
        return parseMoov(moov);
      }
      pos += size;
    }
    return {};
  } catch {
    return {};
  } finally {
    await fh.close();
  }
}
