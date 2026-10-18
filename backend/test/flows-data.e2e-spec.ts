import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

/** Flows (saved runs) and collected data. Needs MongoDB + Chrome. */
const page = (items: string[]) =>
  'data:text/html;charset=utf-8,' + encodeURIComponent(`<h1>Shop</h1><ul>${items.map((t) => `<li><a href="https://shop.test/p/${encodeURIComponent(t)}">${t}</a></li>`).join('')}</ul>`);

describe('Flows and data (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  async function waitJob(id: string) {
    for (let i = 0; i < 150; i++) {
      const { body } = await http().get(`/jobs/${id}`);
      if (['done', 'failed', 'cancelled'].includes(body.status)) return body;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('job did not finish');
  }

  async function waitRecords(scope: string, dataset: string, count: number) {
    for (let i = 0; i < 50; i++) {
      const { body } = await http().get('/data/records').query({ scope, dataset, limit: 100 });
      if (body.total >= count) return body;
      await new Promise((r) => setTimeout(r, 100));
    }
    return (await http().get('/data/records').query({ scope, dataset, limit: 100 })).body;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('runs a saved flow, keeps its data merged across runs and after the job is deleted', async () => {
    const { body: script } = await http()
      .post('/scripts')
      .send({
        name: 'Products',
        actions: [
          { type: 'goto', url: '{{url}}' },
          { type: 'extract', selector: 'h1', as: 'title' },
          { type: 'extract', selector: 'li', multiple: true, fields: { name: 'a', url: { selector: 'a', get: 'prop:href' } }, as: 'products' },
        ],
      })
      .expect(201);

    // JSON inputs: data: URLs contain commas.
    const inputsText = JSON.stringify([
      { name: 'A', url: page(['Áo', 'Quần']) },
      { name: 'B', url: page(['Quần', 'Mũ "đỏ", mới']) },
    ]);
    await http().post('/flows').send({ name: 'Bad', scriptId: script._id, inputsText: '[1,2]' }).expect(400);
    const { body: flow } = await http()
      .post('/flows')
      .send({ name: 'Theo dõi sản phẩm', scriptId: script._id, inputsText, concurrency: 2, headless: true })
      .expect(201);

    const { body: list } = await http().get('/flows').expect(200);
    expect(list.find((f: any) => f._id === flow._id)).toMatchObject({ scriptName: 'Products', profileName: '', runs: 0 });

    // run 1
    const { body: job1 } = await http().post(`/flows/${flow._id}/run`).send({}).expect(201);
    expect(job1).toMatchObject({ flowId: flow._id, name: 'Theo dõi sản phẩm · lần 1' });
    expect((await waitJob(job1._id)).status).toBe('done');

    const scope = `flow:${flow._id}`;
    const products = await waitRecords(scope, 'products', 3);
    // "Quần" is on both pages (same URL) → merged into one row.
    expect(products.total).toBe(3);
    expect(products.columns).toEqual(['name', 'url']);
    const values = await waitRecords(scope, 'kết quả', 2);
    expect(values.items.map((r: any) => r.data.title)).toEqual(['Shop', 'Shop']);

    // run 2 with the same inputs: merged, not duplicated
    const { body: job2 } = await http().post(`/flows/${flow._id}/run`).send({}).expect(201);
    await waitJob(job2._id);
    await new Promise((r) => setTimeout(r, 300));
    const again = (await http().get('/data/records').query({ scope, dataset: 'products', limit: 100 })).body;
    expect(again.total).toBe(3);
    expect(Math.max(...again.items.map((r: any) => r.seenCount))).toBeGreaterThanOrEqual(2);

    const { body: runs } = await http().get(`/flows/${flow._id}/jobs`).expect(200);
    expect(runs.total).toBe(2);
    expect((await http().get(`/flows/${flow._id}`)).body).toMatchObject({ runs: 2, lastJobId: job2._id });

    const { body: datasets } = await http().get('/data/datasets').expect(200);
    expect(datasets.filter((d: any) => d.scope === scope).map((d: any) => [d.dataset, d.count, d.scopeName]).sort()).toEqual([
      ['kết quả', 2, 'Theo dõi sản phẩm'],
      ['products', 3, 'Theo dõi sản phẩm'],
    ]);

    // search + export
    const found = (await http().get('/data/records').query({ scope, dataset: 'products', q: 'MŨ' })).body;
    expect(found.items.map((r: any) => r.data.name)).toEqual(['Mũ "đỏ", mới']);
    const csv = await http().get('/data/export').query({ scope, dataset: 'products' }).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/filename\*=UTF-8''/);
    expect(csv.text.startsWith('﻿name,url\r\n')).toBe(true);
    expect(csv.text).toContain('"Mũ ""đỏ"", mới"');

    // jobs deleted → data kept
    await http().delete(`/jobs/${job1._id}`).expect(204);
    await http().delete(`/jobs/${job2._id}`).expect(204);
    expect((await http().get('/data/records').query({ scope, dataset: 'products' })).body.total).toBe(3);

    // cleanup
    expect((await http().delete('/data/records').query({ scope, dataset: 'products' })).body).toEqual({ deleted: 3 });
    await http().delete('/data/records').query({ scope, dataset: 'kết quả' });
    await http().delete(`/flows/${flow._id}`).expect(204);
    await http().delete(`/scripts/${script._id}`).expect(204);
  }, 90_000);
});
