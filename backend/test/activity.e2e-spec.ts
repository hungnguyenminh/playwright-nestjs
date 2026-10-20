import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

/** The activity log: user changes through the API (secrets masked), failures, filters. Needs MongoDB (test DB). */
describe('Activity log (e2e)', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(() => app?.close());

  async function find(q: Record<string, string>, ok: (items: any[]) => boolean) {
    for (let i = 0; i < 30; i++) {
      const { body } = await http().get('/activity').query(q).expect(200);
      if (ok(body.items)) return body.items;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('activity not found');
  }

  it('logs changes with a readable line, the target and the masked body; failures too', async () => {
    const marker = `act-${Date.now()}`;
    const { body: profile } = await http()
      .post('/profiles')
      .send({ name: marker, mode: 'session', proxy: { server: 'http://p:1', username: 'u', password: 'very-secret' } })
      .expect(201);

    const [created] = await find({ q: marker, category: 'profile' }, (items) => items.some((i) => i.action === 'POST /profiles'));
    expect(created).toMatchObject({
      actor: 'user',
      level: 'info',
      category: 'profile',
      summary: `Tạo profile: ${marker}`,
      target: { type: 'profile', id: profile._id, name: marker },
      details: { status: 201, body: { name: marker, proxy: { password: '***' } } },
    });
    expect(JSON.stringify(created)).not.toContain('very-secret');

    await http().post('/flows').send({ name: marker, kind: 'sources', sources: [] }).expect(400);
    const [failed] = await find({ q: marker, level: 'warn' }, (items) => items.some((i) => i.action === 'POST /flows'));
    expect(failed.summary).toContain('Tạo luồng thất bại');

    await http().delete(`/profiles/${profile._id}`).expect(204);
    await find({ q: profile._id, actor: 'user' }, (items) => items.some((i) => i.action === 'DELETE /profiles/:id' && i.summary === 'Xoá profile'));

    // Reads and checks are not logged.
    await http().post('/posts/check').send({ post: { title: marker } }).expect(200);
    const { body: all } = await http().get('/activity').query({ q: marker }).expect(200);
    expect(all.items.some((i: any) => i.action === 'POST /posts/check')).toBe(false);
    expect((await http().get('/activity/categories')).body).toEqual(expect.arrayContaining(['profile', 'flow']));
  });
});
