import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

/** Posts and media. Needs MongoDB (test DB) + Chrome (to make a real PNG). */
describe('Posts and media (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let base = '';
  let png: Buffer;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    png = await page.screenshot({ type: 'png' });
    await browser.close();

    server = createServer((req, res) => {
      if (req.url === '/pic.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(png);
      res.writeHead(200, { 'content-type': 'text/html' }).end('<p>not an image</p>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    server?.close();
  });

  it('uploads media, writes posts per platform and only lets valid posts be ready', async () => {
    const { body: up } = await http().post('/media').attach('file', png, { filename: 'anh.png', contentType: 'image/png' }).expect(201);
    expect(up).toMatchObject({ kind: 'image', mime: 'image/png', width: 400, height: 300, name: 'anh.png' });
    expect(up.path).toBeUndefined();
    const file = await http().get(`/media/${up._id}/file`).expect(200);
    expect(file.headers['content-type']).toBe('image/png');

    const { body: fromUrl } = await http().post('/media/from-url').send({ url: `${base}/pic.png` }).expect(201);
    expect(fromUrl).toMatchObject({ kind: 'image', width: 400, sourceUrl: `${base}/pic.png`, name: 'pic.png' });
    await http().post('/media/from-url').send({ url: `${base}/page` }).expect(400);
    await http().post('/media').attach('file', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' }).expect(400);

    const { body: platforms } = await http().get('/publish/platforms').expect(200);
    expect(platforms.map((p: any) => p.platform)).toEqual(['facebook', 'youtube', 'tiktok', 'threads']);

    // Live check of an unsaved post.
    const { body: check } = await http()
      .post('/posts/check')
      .send({ post: { title: 'Khai trương', content: 'Giảm 50%', hashtags: ['#sale'], mediaIds: [up._id, fromUrl._id], platforms: { facebook: {}, youtube: {} } } })
      .expect(200);
    expect(check.facebook).toMatchObject({ format: 'album', auto: true, errors: [], text: 'Giảm 50%\n\n#sale' });
    expect(check.youtube.errors).toContain('YouTube cần 1 video');

    // Can't be ready with errors; can be saved as draft.
    const draft = { title: 'Khai trương', content: 'Giảm 50%', mediaIds: [up._id], platforms: { facebook: {}, youtube: {} }, tags: ['shop'] };
    const bad = await http().post('/posts').send({ ...draft, status: 'ready' }).expect(400);
    expect(bad.body.message).toContain('youtube: YouTube cần 1 video');
    await http().post('/posts').send({ ...draft, status: 'ready', platforms: {} }).expect(400);
    const { body: p1 } = await http().post('/posts').send(draft).expect(201);
    expect(p1).toMatchObject({ status: 'draft', origin: 'manual', media: [{ _id: up._id }], checks: { facebook: { format: 'photo' } } });

    const { body: p2 } = await http()
      .post('/posts')
      .send({ title: 'Chuỗi', platforms: { threads: { format: 'chain', parts: ['Một', 'Hai'] } }, status: 'ready', tags: ['shop'] })
      .expect(201);
    expect(p2.status).toBe('ready');

    // Bulk approve: p1 still targets YouTube without a video → refused, listed with its errors.
    const { body: bulk } = await http().post('/posts/bulk-status').send({ ids: [p1._id, p2._id], status: 'ready' }).expect(200);
    expect(bulk.updated).toBe(1);
    expect(bulk.failed).toEqual([{ id: p1._id, title: 'Khai trương', errors: ['youtube: YouTube cần 1 video'] }]);

    const { body: fixed } = await http().put(`/posts/${p1._id}`).send({ ...draft, platforms: { facebook: { format: 'photo', firstComment: 'Link ở đây' } }, status: 'ready' }).expect(200);
    expect(fixed).toMatchObject({ status: 'ready', platforms: { facebook: { format: 'photo', firstComment: 'Link ở đây' } } });

    const { body: copy } = await http().post(`/posts/${p1._id}/duplicate`).expect(201);
    expect(copy).toMatchObject({ title: 'Khai trương (bản sao)', status: 'draft' });

    const { body: ready } = await http().get('/posts').query({ status: 'ready', tag: 'shop' }).expect(200);
    const readyIds = ready.items.map((p: any) => p._id);
    expect(readyIds).toEqual(expect.arrayContaining([p1._id, p2._id]));
    expect(readyIds).not.toContain(copy._id);
    const { body: found } = await http().get('/posts').query({ q: 'bản sao' }).expect(200);
    expect(found.items.map((p: any) => p._id)).toContain(copy._id);
    expect((await http().get('/posts/tags')).body).toContain('shop');

    for (const id of [p1._id, p2._id, copy._id]) await http().delete(`/posts/${id}`).expect(204);
    for (const id of [up._id, fromUrl._id]) await http().delete(`/media/${id}`).expect(204);
    await http().get(`/media/${up._id}/file`).expect(404);
  });
});
