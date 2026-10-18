import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

/**
 * Needs MongoDB (MONGODB_URI, a separate test database by default) and Google
 * Chrome installed. Pages are served as data: URLs, no network required.
 */
process.env.MONGODB_URI ??= 'mongodb://localhost:27017/browser-automation-test';

const page = (body: string) =>
  'data:text/html,' + encodeURIComponent(`<html><body>${body}</body></html>`);

async function waitForJob(app: INestApplication, id: string) {
  for (let i = 0; i < 100; i++) {
    const { body } = await request(app.getHttpServer()).get(`/jobs/${id}`);
    if (['done', 'failed', 'cancelled'].includes(body.status)) return body;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('job did not finish');
}

describe('Automation API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a script with invalid actions', async () => {
    const res = await request(app.getHttpServer())
      .post('/scripts')
      .send({ name: 'bad', actions: [{ type: 'goto' }] })
      .expect(400);
    expect(res.body.errors[0]).toMatch(/url/);
  });

  it('runs one task per input in parallel and stores results and logs', async () => {
    const { body: script } = await request(app.getHttpServer())
      .post('/scripts')
      .send({
        name: 'e2e title',
        actions: [
          { type: 'goto', url: '{{url}}' },
          { type: 'extract', selector: 'h1', as: 'title' },
          { type: 'screenshot', name: 'shot' },
        ],
      })
      .expect(201);

    const inputs = ['One', 'Two', 'Three', 'Four'].map((t) => ({
      name: t,
      url: page(`<h1>${t}</h1>`),
    }));
    const { body: job } = await request(app.getHttpServer())
      .post('/jobs')
      .send({ scriptId: script._id, inputs, concurrency: 4, headless: true })
      .expect(201);

    const done = await waitForJob(app, job._id);
    expect(done.status).toBe('done');
    expect(done.totals.done).toBe(4);

    const { body: tasks } = await request(app.getHttpServer()).get(`/jobs/${job._id}/tasks`);
    expect(tasks.items.map((t: any) => t.result.title)).toEqual(['One', 'Two', 'Three', 'Four']);

    const taskId = tasks.items[0]._id;
    const { body: logs } = await request(app.getHttpServer()).get(`/tasks/${taskId}/logs`);
    expect(logs.map((l: any) => l.type)).toEqual(['goto', 'extract', 'screenshot']);

    const { body: artifacts } = await request(app.getHttpServer()).get(`/tasks/${taskId}/artifacts`);
    expect(artifacts).toHaveLength(1);
    await request(app.getHttpServer())
      .get(`/artifacts/${artifacts[0]._id}`)
      .expect(200)
      .expect('content-type', 'image/png');

    await request(app.getHttpServer()).delete(`/jobs/${job._id}`).expect(204);
    await request(app.getHttpServer()).delete(`/scripts/${script._id}`).expect(204);
  }, 60_000);

  it('records the failing step and retries on demand', async () => {
    const { body: job } = await request(app.getHttpServer())
      .post('/jobs')
      .send({
        actions: [
          { type: 'goto', url: page('<p>no button</p>') },
          { type: 'click', selector: '#missing', timeout: 500 },
        ],
      })
      .expect(201);
    const failed = await waitForJob(app, job._id);
    expect(failed.status).toBe('failed');

    const { body: tasks } = await request(app.getHttpServer()).get(`/jobs/${job._id}/tasks`);
    expect(tasks.items[0].error).toMatchObject({ stepPath: '2', actionType: 'click' });
    expect(tasks.items[0].error.screenshot).toBeTruthy();

    await request(app.getHttpServer()).post(`/jobs/${job._id}/retry`).expect(201);
    expect((await waitForJob(app, job._id)).status).toBe('failed');
    const { body: again } = await request(app.getHttpServer()).get(`/jobs/${job._id}/tasks`);
    expect(again.items[0].attempt).toBe(2);

    await request(app.getHttpServer()).delete(`/jobs/${job._id}`).expect(204);
  }, 60_000);
});
