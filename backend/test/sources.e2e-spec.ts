import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

/** Multi-source flows against a small local shop. Needs MongoDB + Chrome. */
const card = (name: string) =>
  `<div class="card"><a href="/p/${encodeURIComponent(name)}"><img src="/img/${encodeURIComponent(name)}.jpg"></a><h3 class="name"><a href="/p/${encodeURIComponent(name)}">${name}</a></h3><b class="price">199.000₫</b></div>`;
const PRODUCTS = ['Áo thun', 'Áo khoác', 'Quần jean', 'Quần short', 'Mũ lưỡi trai'];
const shell = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body><header><form action="/search"><input name="q" placeholder="Tìm sản phẩm"></form></header><main>${body}</main></body></html>`;

describe('Sources (e2e)', () => {
  let app: INestApplication;
  let shop: Server;
  let base = '';
  const http = () => request(app.getHttpServer());

  async function waitJob(id: string) {
    for (let i = 0; i < 400; i++) {
      const { body } = await http().get(`/jobs/${id}`);
      if (['done', 'failed', 'cancelled'].includes(body.status)) return body;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('job did not finish');
  }

  beforeAll(async () => {
    shop = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      res.setHeader('content-type', 'text/html; charset=utf-8');
      if (url.pathname === '/') return res.end(shell(`<section class="grid">${PRODUCTS.map(card).join('')}</section>`));
      if (url.pathname === '/search') {
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        const found = PRODUCTS.filter((p) => p.toLowerCase().includes(q));
        return res.end(shell(`<h1>Kết quả</h1><section class="grid">${found.map(card).join('')}</section>`));
      }
      res.statusCode = 404;
      res.end('');
    });
    await new Promise<void>((r) => shop.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(shop.address() as AddressInfo).port}`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    shop?.close();
  });

  it('lists sources and previews the job of a source', async () => {
    const { body } = await http().get('/sources').expect(200);
    expect(body.defaultLimit).toBe(50);
    expect(body.sources.map((s: any) => s.type)).toEqual(['website', 'facebook', 'google', 'youtube', 'tiktok', 'threads', 'shopee']);

    const { body: preview } = await http()
      .post('/sources/preview')
      .send({ type: 'website', targets: [`${base}/`], keywords: ['áo', 'quần'] })
      .expect(201);
    expect(preview.errors).toEqual([]);
    expect(preview.job.inputs).toHaveLength(2);

    const { body: bad } = await http().post('/sources/preview').send({ type: 'website', targets: ['abc'] }).expect(201);
    expect(bad.errors[0]).toContain('link không hợp lệ');
  });

  it('runs every source of a flow as one run and stores items per source', async () => {
    await http().post('/flows').send({ name: 'x', kind: 'sources', sources: [] }).expect(400);
    await http().post('/flows').send({ name: 'x', kind: 'sources', sources: [{ type: 'website', targets: ['abc'] }] }).expect(400);
    await http().post('/flows').send({ name: 'x', kind: 'sources', sources: [{ type: 'nope', targets: ['a'] }] }).expect(400);

    const { body: flow } = await http()
      .post('/flows')
      .send({
        name: 'Theo dõi shop',
        kind: 'sources',
        concurrency: 2,
        headless: true,
        sources: [
          { type: 'website', targets: [`${base}/`], keywords: ['áo', 'quần', 'xyz', ' '], limit: 10 },
          { type: 'website', targets: [`${base}/`], limit: 3 },
        ],
      })
      .expect(201);
    expect(flow).toMatchObject({ kind: 'sources', sources: [{ keywords: ['áo', 'quần', 'xyz'], limit: 10, detail: false }, { keywords: [], limit: 3 }] });
    expect(flow.scriptId).toBeUndefined();

    const { body: run } = await http().post(`/flows/${flow._id}/run`).send({}).expect(201);
    expect(run.jobs).toHaveLength(2);
    expect(run.jobs.every((j: any) => j.runId === run.runId && j.source === 'website' && j.flowId === flow._id)).toBe(true);
    const jobs = await Promise.all(run.jobs.map((j: any) => waitJob(j._id)));
    expect(jobs.map((j) => j.status)).toEqual(['done', 'done']);

    const { body: tasks } = await http().get(`/jobs/${run.jobs[0]._id}/tasks`).expect(200);
    const byKeyword = Object.fromEntries(tasks.items.map((t: any) => [t.vars.keyword, t.result.website]));
    expect(byKeyword['áo'].map((i: any) => i.title)).toEqual(['Áo thun', 'Áo khoác']);
    // No results: an empty list, not the text of the results page.
    expect(byKeyword['xyz']).toEqual([]);
    expect(byKeyword['quần'][0]).toMatchObject({
      source: 'website',
      from: `${base}/`,
      keyword: 'quần',
      title: 'Quần jean',
      url: `${base}/p/${encodeURIComponent('Quần jean')}`,
      image: `${base}/img/${encodeURIComponent('Quần jean')}.jpg`,
      price: '199.000₫',
    });
    const { body: plain } = await http().get(`/jobs/${run.jobs[1]._id}/tasks`).expect(200);
    expect(plain.items[0].result.website).toHaveLength(3);
    expect(plain.items[0].result.website[0]).not.toHaveProperty('keyword');

    // One dataset per source; the same product found twice is one row.
    let records: any;
    for (let i = 0; i < 50; i++) {
      records = (await http().get('/data/records').query({ scope: `flow:${flow._id}`, dataset: 'website', limit: 50 })).body;
      if (records.total >= 4) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(records.total).toBe(4);
    expect(records.columns.slice(0, 4)).toEqual(['source', 'from', 'keyword', 'title']);

    const { body: list } = await http().get('/flows').expect(200);
    expect(list.find((f: any) => f._id === flow._id)).toMatchObject({ scriptName: 'Website khác, Website khác', runs: 1, lastRunId: run.runId });

    await http().delete(`/data/records`).query({ scope: `flow:${flow._id}`, dataset: 'website' }).expect(200);
    await Promise.all(run.jobs.map((j: any) => http().delete(`/jobs/${j._id}`).expect(204)));
    await http().delete(`/flows/${flow._id}`).expect(204);
  }, 120_000);

  it('test-runs a source on its first target with a few items', async () => {
    const { body: job } = await http()
      .post('/sources/test')
      .send({ type: 'website', targets: [`${base}/`, `${base}/other`], keywords: ['áo', 'quần'], limit: 50 })
      .expect(201);
    expect(job).toMatchObject({ source: 'website', totals: { queued: 1 } });
    expect((await waitJob(job._id)).status).toBe('done');
    const { body: tasks } = await http().get(`/jobs/${job._id}/tasks`).expect(200);
    expect(tasks.items[0].result.website.map((i: any) => i.title)).toEqual(['Áo thun', 'Áo khoác']);
    await http().delete(`/jobs/${job._id}`).expect(204);
  }, 60_000);
});
