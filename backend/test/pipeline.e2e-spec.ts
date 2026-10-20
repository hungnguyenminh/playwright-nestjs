import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { FakeAnthropic } from './fake-anthropic.js';

/**
 * Crawl → AI posts → publish, with three fakes: a shop (crawled), the
 * Anthropic API (writes the posts) and a social network (publishing).
 * Needs MongoDB (test DB) + Chrome.
 */
describe('Crawl → publish flows (e2e)', () => {
  let app: INestApplication;
  let shop: Server;
  let social: Server;
  const ai = new FakeAnthropic();
  const published: string[] = [];
  let base = '';
  const http = () => request(app.getHttpServer());

  const PRODUCTS = ['Vợt cầu lông Yonex', 'Giày cầu lông Lining', 'Ống cầu Thành Công'];
  const card = (name: string, i: number) =>
    `<div class="card"><a href="/p/${i}"><img src="/img/${i}.jpg" width="100" height="80"></a><h3 class="name"><a href="/p/${i}">${name}</a></h3><b class="price">${i + 1}99.000₫</b></div>`;

  async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 60_000): Promise<T> {
    const end = Date.now() + ms;
    let v = await fn();
    while (!ok(v)) {
      if (Date.now() > end) throw new Error(`timeout, last: ${JSON.stringify(v).slice(0, 600)}`);
      await new Promise((r) => setTimeout(r, 300));
      v = await fn();
    }
    return v;
  }

  beforeAll(async () => {
    shop = createServer((req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (req.url === '/') return res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body><main><section class="grid">${PRODUCTS.map(card).join('')}</section></main></body></html>`);
      res.statusCode = 404;
      res.end('');
    });
    social = createServer((req, res) => {
      if (req.url?.startsWith('/compose')) {
        return res
          .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          .end(
            `<textarea id="content"></textarea><input id="media" type="file" multiple><button id="submit" onclick="fetch('/posted',{method:'POST',body:document.querySelector('#content').value}).then(()=>document.body.insertAdjacentHTML('beforeend','<a id=post-url href=http://social.test/p>b</a><p id=done>xong</p>'))">Đăng</button>`,
          );
      }
      if (req.url === '/posted') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          published.push(body);
          res.writeHead(200).end('{}');
        });
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => shop.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => social.listen(0, '127.0.0.1', r));
    await ai.start();
    base = `http://127.0.0.1:${(shop.address() as AddressInfo).port}`;
    process.env.PUBLISH_FAKE_URL = `http://127.0.0.1:${(social.address() as AddressInfo).port}`;
    process.env.PUBLISH_TICK_MS = '500';
    process.env.FLOW_TICK_MS = '500';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await http().put('/settings/ai').send({ enabled: true, baseUrl: ai.url, authType: 'bearer', token: 'sk-test', model: 'fake-model', effort: '' }).expect(200);
  });

  afterAll(async () => {
    await http().put('/settings/ai').send({ token: '', baseUrl: '', model: '' });
    await app?.close();
    shop?.close();
    social?.close();
    await ai.stop();
    for (const k of ['PUBLISH_FAKE_URL', 'PUBLISH_TICK_MS', 'FLOW_TICK_MS']) delete process.env[k];
  });

  it('crawls, has the AI write posts from new rows (fixing its own mistakes), and publishes them on schedule', async () => {
    const { body: profile } = await http().post('/profiles').send({ name: 'pipe-acc', mode: 'session' }).expect(201);
    // Round 1 uses markdown (refused by the checks), round 2 fixes it.
    const post = (i: number, content: string) => ({ title: `Bài ${PRODUCTS[i]}`, content, hashtags: ['caulong'], source_indexes: [i] });
    ai.turns = [
      { text: 'Viết bài…', tool: { name: 'save_posts', input: { posts: [post(0, '**Vợt Yonex** giá 199.000₫'), post(1, 'Giày Lining giá 299.000₫')] } } },
      { text: 'Đã sửa.', tool: { name: 'save_posts', input: { posts: [post(0, 'Vợt Yonex giá 199.000₫, đánh cực sướng'), post(1, 'Giày Lining giá 299.000₫, êm chân')] } } },
    ];

    const flowBody = {
      name: 'Shop cầu lông → Facebook',
      kind: 'pipeline',
      sources: [{ type: 'website', targets: [`${base}/`], limit: 3 }],
      autoRun: { enabled: false, every: 6, unit: 'hour' },
      generate: { mode: 'perRecord', prompt: 'Viết ngắn, vui', platforms: ['facebook'], maxPostsPerRun: 2, attachImage: false, approval: 'auto' },
      campaign: {
        destinations: [{ platform: 'facebook', kind: 'self', profileIds: [profile._id], accountMode: 'all', limits: { minGapPerProfileMinutes: 0, maxPerProfilePerDay: 50, noRepeatPostDays: 30 } }],
        schedule: { mode: 'interval', startAt: new Date().toISOString(), every: 1, unit: 'minute' },
        minGapMinutes: 0,
      },
    };
    await http().post('/flows').send({ ...flowBody, generate: { ...flowBody.generate, platforms: [] } }).expect(400);
    const { body: flow } = await http().post('/flows').send(flowBody).expect(201);
    expect(flow).toMatchObject({ kind: 'pipeline', campaignId: expect.any(String), generate: { maxPostsPerRun: 2, approval: 'auto' }, autoRun: { enabled: false, every: 6 } });
    const { body: campaign } = await http().get(`/campaigns/${flow.campaignId}`).expect(200);
    expect(campaign).toMatchObject({ status: 'active', postSource: { type: 'flow', flowId: flow._id }, whenExhausted: 'wait' });

    // Before any post exists, the first publication waits for one.
    await until(() => http().get(`/campaigns/${flow.campaignId}/publications`).then((r) => r.body.items), (items) => items[0]?.status === 'waiting');

    const { body: started } = await http().post(`/flows/${flow._id}/run`).send({}).expect(201);
    const run = await until(
      () => http().get(`/flows/${flow._id}/runs`).then((r) => r.body[0]),
      (r) => r && ['done', 'failed'].includes(r.status),
      90_000,
    );
    expect(run).toMatchObject({ runId: started.runId, status: 'done', trigger: 'manual', jobs: 1, newRecords: 3, postsCreated: 2 });

    // The model got the rows and, on the second request, the list of problems.
    expect(ai.requests).toHaveLength(2);
    expect(JSON.stringify(ai.requests[0].body.messages)).toContain('Vợt cầu lông Yonex');
    expect(JSON.stringify(ai.requests[1].body.messages)).toContain('có markdown');

    const { body: posts } = await http().get('/posts').query({ flowId: flow._id }).expect(200);
    expect(posts.items).toHaveLength(2);
    expect(posts.items.every((p: any) => p.origin === 'ai' && p.status === 'ready' && p.sourceRecords.length === 1 && p.tags.includes(flow.name))).toBe(true);
    expect(posts.items.map((p: any) => p.link).sort()).toEqual([`${base}/p/0`, `${base}/p/1`]);

    // The waiting publication takes the oldest new post and posts it.
    const pubs = await until(() => http().get(`/campaigns/${flow.campaignId}/publications`).then((r) => r.body.items), (items) => items[0]?.status === 'published', 60_000);
    expect(pubs[0].postTitle).toBe('Bài Vợt cầu lông Yonex');
    expect(published[0]).toContain('Vợt Yonex giá 199.000₫, đánh cực sướng');
    expect(published[0]).toContain('#caulong');

    // The third row has no post yet; generating again for every row only writes that one.
    const { body: rows } = await http().get('/data/records').query({ scope: `flow:${flow._id}`, dataset: 'website', limit: 10 }).expect(200);
    ai.turns = [{ text: 'ok', tool: { name: 'save_posts', input: { posts: [{ title: 'Bài ống cầu', content: 'Ống cầu Thành Công, bền', hashtags: [], source_indexes: [0] }] } } }];
    const { body: gen } = await http()
      .post('/posts/generate')
      .send({ recordIds: rows.items.map((r: any) => r._id), platforms: ['facebook', 'threads'], approval: 'review' })
      .expect(201);
    expect(gen.created).toEqual([expect.objectContaining({ title: 'Bài ống cầu', status: 'draft' })]);
    expect(gen.skipped).toHaveLength(2);

    // A second run finds no new rows: nothing to write.
    await http().post(`/flows/${flow._id}/run`).send({}).expect(201);
    const second = await until(() => http().get(`/flows/${flow._id}/runs`).then((r) => r.body), (r) => r.length === 2 && r[0].status === 'done', 90_000);
    expect(second[0]).toMatchObject({ newRecords: 0, postsCreated: 0 });

    // Auto-run on: the next run is planned 6 hours ahead.
    const { body: auto } = await http().post(`/flows/${flow._id}/auto-run`).send({ enabled: true }).expect(200);
    expect(new Date(auto.autoRun.nextRunAt).getTime() - Date.now()).toBeGreaterThan(5.9 * 3_600_000);

    await http().delete(`/flows/${flow._id}`).expect(204);
    await http().get(`/campaigns/${flow.campaignId}`).expect(404);
    for (const p of [...posts.items, ...gen.created]) await http().delete(`/posts/${p._id}`);
    await http().delete('/data/records').query({ scope: `flow:${flow._id}`, dataset: 'website' });
    await http().delete(`/profiles/${profile._id}`);
  }, 240_000);
});
