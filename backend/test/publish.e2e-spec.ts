import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

/**
 * Publishing campaigns against a fake "social network" page (PUBLISH_FAKE_URL):
 * nothing is posted anywhere real. Needs MongoDB (test DB) + Chrome.
 */
describe('Publishing campaigns (e2e, fake publisher)', () => {
  let app: INestApplication;
  let fake: Server;
  const fakeState = { loginFailNext: 0, posts: [] as Array<{ platform: string; kind: string; url: string; content: string }> };
  const http = () => request(app.getHttpServer());
  const created = { profiles: [] as string[], posts: [] as string[], campaigns: [] as string[] };

  const COMPOSE = () => `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <textarea id="content"></textarea><input id="media" type="file" multiple>
    <button id="submit" onclick="
      fetch('/posted', { method: 'POST', body: JSON.stringify({ q: location.search, content: document.querySelector('#content').value }) })
        .then((r) => r.json()).then((r) => {
          document.body.insertAdjacentHTML('beforeend', r.pending ? '<p id=pending>chờ duyệt</p><p id=done>xong</p>' : '<a id=post-url href=' + r.url + '>bài</a><p id=done>xong</p>');
        });
    ">Đăng</button></body></html>`;

  async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 60_000): Promise<T> {
    const end = Date.now() + ms;
    let v = await fn();
    while (!ok(v)) {
      if (Date.now() > end) throw new Error(`timeout, last value: ${JSON.stringify(v).slice(0, 800)}`);
      await new Promise((r) => setTimeout(r, 300));
      v = await fn();
    }
    return v;
  }
  const pubs = (id: string) => http().get(`/campaigns/${id}/publications`).then((r) => r.body.items as any[]);
  const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();

  beforeAll(async () => {
    fake = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/compose') {
        if (fakeState.loginFailNext > 0) {
          fakeState.loginFailNext--;
          return res.writeHead(200, { 'content-type': 'text/html' }).end('<p id="login">Đăng nhập</p>');
        }
        return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(COMPOSE());
      }
      if (url.pathname === '/posted') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const { q, content } = JSON.parse(body);
          const p = new URLSearchParams(q);
          fakeState.posts.push({ platform: p.get('platform')!, kind: p.get('kind')!, url: p.get('url')!, content });
          const pending = (p.get('url') ?? '').includes('pending');
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ pending, url: `http://fake.test/p/${fakeState.posts.length}` }));
        });
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    process.env.PUBLISH_FAKE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    process.env.PUBLISH_TICK_MS = '400';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    for (const name of ['pub-A', 'pub-B', 'pub-C']) {
      const { body } = await http().post('/profiles').send({ name, mode: 'session' }).expect(201);
      created.profiles.push(body._id);
    }
    for (const [title, content] of [['Bài 1', 'Nội dung 1'], ['Bài 2', 'Nội dung 2'], ['Bài 3', 'Nội dung 3']]) {
      const { body } = await http().post('/posts').send({ title, content, platforms: { facebook: {}, threads: {} }, status: 'ready' }).expect(201);
      created.posts.push(body._id);
    }
  });

  afterAll(async () => {
    for (const id of created.campaigns) await http().post(`/campaigns/${id}/cancel`);
    await new Promise((r) => setTimeout(r, 500));
    for (const id of created.campaigns) await http().delete(`/campaigns/${id}`);
    for (const id of created.posts) await http().delete(`/posts/${id}`);
    for (const id of created.profiles) await http().delete(`/profiles/${id}`);
    await app?.close();
    fake?.close();
    delete process.env.PUBLISH_FAKE_URL;
    delete process.env.PUBLISH_TICK_MS;
  });

  const noLimits = { minGapPerProfileMinutes: 0, maxPerProfilePerDay: 50, noRepeatPostDays: 0 };

  it('validates destinations and warns about spammy settings', async () => {
    const base = { name: 'x', postSource: { type: 'list', postIds: created.posts }, schedule: { mode: 'once' } };
    const post = await http()
      .post('/campaigns/preview')
      .send({ ...base, destinations: [{ platform: 'facebook', kind: 'group', url: 'https://www.facebook.com/groups/g/posts/1', profileIds: created.profiles, accountMode: 'rotate' }] })
      .expect(400);
    expect(post.body.message).toContain('link bài viết / mục trong nhóm');
    await http()
      .post('/campaigns/preview')
      .send({ ...base, destinations: [{ platform: 'youtube', kind: 'group', url: 'x', profileIds: created.profiles, accountMode: 'all' }] })
      .expect(400);

    const { body: preview } = await http()
      .post('/campaigns/preview')
      .send({
        ...base,
        postSource: { type: 'list', postIds: created.posts },
        schedule: { mode: 'interval', startAt: inSeconds(3600), every: 30, unit: 'minute', count: 4 },
        destinations: [{ platform: 'facebook', kind: 'group', url: 'https://m.facebook.com/groups/caulong', profileIds: created.profiles.slice(0, 2), accountMode: 'rotate' }],
      })
      .expect(200);
    expect(preview.errors).toEqual([]);
    expect(preview.warnings.join(' ')).toContain('mỗi profile 1 giờ đăng 1 lần');
    expect(preview.publications.map((p: any) => p.plannedProfileId)).toEqual([created.profiles[0], created.profiles[1], created.profiles[0], created.profiles[1]]);

    const { body: ytPreview } = await http()
      .post('/campaigns/preview')
      .send({ ...base, destinations: [{ platform: 'youtube', kind: 'self', profileIds: created.profiles.slice(0, 1), accountMode: 'all' }] })
      .expect(200);
    expect(ytPreview.errors[0]).toContain('không đăng được lên YouTube');
  });

  it('rotates accounts into one group, skips an account that needs to log in again', async () => {
    fakeState.loginFailNext = 1;
    const { body: c } = await http()
      .post('/campaigns')
      .send({
        name: 'Nhóm xoay vòng',
        destinations: [{ platform: 'facebook', kind: 'group', url: 'https://www.facebook.com/groups/caulong', profileIds: created.profiles, accountMode: 'rotate', limits: noLimits }],
        postSource: { type: 'list', postIds: created.posts },
        schedule: { mode: 'slots', slots: [{ at: inSeconds(1) }, { at: inSeconds(2) }, { at: inSeconds(3) }] },
        minGapMinutes: 0,
      })
      .expect(201);
    created.campaigns.push(c._id);
    expect(c.status).toBe('draft');
    await http().post(`/campaigns/${c._id}/activate`).expect(200);

    const done = await until(() => pubs(c._id), (items) => items.length === 3 && items.every((p) => p.status === 'published'), 90_000);
    const [A, B, C] = created.profiles;
    // Slot 1: A needed to log in → B posted it. Slot 2: C. Slot 3: A is skipped (needs login) → B.
    expect(done.map((p) => p.profileId)).toEqual([B, C, B]);
    expect(done[0].attempts).toEqual([expect.objectContaining({ profileId: A, error: expect.stringContaining('NEEDS_LOGIN') })]);
    expect(done.map((p) => p.postTitle)).toEqual(['Bài 1', 'Bài 2', 'Bài 3']);
    expect(done.every((p) => p.postUrl?.startsWith('http://fake.test/p/'))).toBe(true);
    const profileA = (await http().get(`/profiles/${A}`)).body;
    expect(profileA.health).toMatchObject({ needsLogin: true });
    await http().post(`/profiles/${A}/health/clear`).expect(204);

    const camp = await until(() => http().get(`/campaigns/${c._id}`).then((r) => r.body), (x) => x.status === 'done');
    expect(camp.log.map((l: any) => l.message)).toEqual(['Kích hoạt', 'Hoàn tất']);
    const post1 = (await http().get(`/posts/${created.posts[0]}`)).body;
    expect(post1.usedCount).toBe(1);
    expect(fakeState.posts.at(-1)).toMatchObject({ platform: 'facebook', kind: 'group', url: 'https://www.facebook.com/groups/caulong', content: 'Nội dung 3' });
  }, 120_000);

  it('every account posts to its own profile, staggered; groups that review posts give pending_approval', async () => {
    const [A, B] = created.profiles;
    const { body: c } = await http()
      .post('/publish/now')
      .send({
        postId: created.posts[1],
        targets: [
          { platform: 'threads', kind: 'self', profileId: A },
          { platform: 'facebook', kind: 'group', url: 'https://www.facebook.com/groups/pending.group', profileId: B },
        ],
      })
      .expect(201);
    created.campaigns.push(c._id);
    expect(c.status).toBe('active');
    const items = await until(() => pubs(c._id), (x) => x.length === 2 && x.every((p) => !['scheduled', 'waiting', 'running'].includes(p.status)));
    expect(items.map((p) => [p.platform, p.status])).toEqual([
      ['threads', 'published'],
      ['facebook', 'pending_approval'],
    ]);
  }, 60_000);

  it('after downtime the late slot runs now and the rest keeps the spacing', async () => {
    const [, , C] = created.profiles;
    const { body: c } = await http()
      .post('/campaigns')
      .send({
        name: 'Máy tắt',
        destinations: [{ platform: 'threads', kind: 'self', profileIds: [C], accountMode: 'all', limits: noLimits }],
        postSource: { type: 'list', postIds: created.posts },
        whenExhausted: 'loop',
        schedule: { mode: 'interval', startAt: inSeconds(3600), every: 1, unit: 'hour', count: 3 },
        minGapMinutes: 0,
      })
      .expect(201);
    created.campaigns.push(c._id);
    await http().post(`/campaigns/${c._id}/pause`).expect(409);
    await http().post(`/campaigns/${c._id}/activate`).expect(200);
    await http().post(`/campaigns/${c._id}/pause`).expect(200);
    const before = await pubs(c._id);
    expect(before.map((p) => p.status)).toEqual(['scheduled', 'scheduled', 'scheduled']);

    // Pretend the machine was off: slot 1 was due 3 h ago, slot 2 2 h ago, slot 3 1 h ago.
    const h = 3_600_000;
    for (const [i, p] of before.entries()) {
      await http().put(`/publications/${p._id}`).send({ scheduledAt: new Date(Date.now() - (3 - i) * h).toISOString() }).expect(200);
    }
    await http().post(`/campaigns/${c._id}/resume`).expect(200);

    const after = await until(() => pubs(c._id), (x) => x[0].status === 'published');
    const t = after.map((p) => new Date(p.scheduledAt).getTime());
    expect(Math.abs(t[0] - Date.now())).toBeLessThan(60_000);
    expect(Math.round((t[1] - t[0]) / 60_000)).toBe(60);
    expect(Math.round((t[2] - t[1]) / 60_000)).toBe(60);
    expect(after.slice(1).map((p) => p.status)).toEqual(['scheduled', 'scheduled']);
    const camp = (await http().get(`/campaigns/${c._id}`)).body;
    expect(camp.log.map((l: any) => l.message).join(' | ')).toMatch(/Dời lịch 18\d phút do máy tắt/);

    // Manual actions on the remaining publications.
    await http().post(`/publications/${after[2]._id}/skip`).expect(200);
    await http().post(`/publications/${after[2]._id}/skip`).expect(409);
    const at = new Date(after[1].scheduledAt).getTime();
    const { body: up } = await http()
      .get('/publish/upcoming')
      .query({ from: new Date(at - 60_000).toISOString(), to: new Date(at + 60_000).toISOString() })
      .expect(200);
    expect(up.items.some((p: any) => p._id === after[1]._id && p.campaignName === 'Máy tắt')).toBe(true);
    const { body: stats } = await http().get(`/campaigns/${c._id}/stats`).expect(200);
    expect(stats).toContainEqual({ destIndex: 0, profileId: C, status: 'published', n: 1 });
  }, 60_000);
});
