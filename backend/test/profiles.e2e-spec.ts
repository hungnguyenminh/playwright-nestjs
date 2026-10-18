import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { Profile } from './../src/profiles/profile.schema.js';
import { ProfilesService } from './../src/profiles/profiles.service.js';

/** Profiles: folder vs session (cookies in the database) mode. Needs MongoDB + Chrome. */
describe('Profiles (e2e)', () => {
  let app: INestApplication;
  let site: Server;
  let base = '';
  const http = () => request(app.getHttpServer());

  async function runJob(body: Record<string, unknown>) {
    const { body: job } = await http().post('/jobs').send(body).expect(201);
    for (let i = 0; i < 150; i++) {
      const { body: j } = await http().get(`/jobs/${job._id}`);
      if (['done', 'failed', 'cancelled'].includes(j.status)) {
        const { body: tasks } = await http().get(`/jobs/${job._id}/tasks`);
        await http().delete(`/jobs/${job._id}`);
        return { job: j, tasks: tasks.items };
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('job did not finish');
  }

  const echo = (profileId: string, inputs?: unknown[], concurrency?: number) =>
    runJob({
      profileId,
      inputs,
      concurrency,
      actions: [
        { type: 'goto', url: `${base}/echo` },
        { type: 'extract', selector: '#c', as: 'cookies' },
      ],
    });

  beforeAll(async () => {
    site = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/set') {
        res.setHeader('Set-Cookie', `sid=${url.searchParams.get('v')}; Path=/; Max-Age=3600`);
      }
      res.setHeader('content-type', 'text/html');
      res.end(`<pre id="c">${req.headers.cookie ?? '(none)'}</pre>`);
    });
    await new Promise<void>((r) => site.listen(0, r));
    base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    site?.close();
  });

  it('imports a folder login into the database, then runs it in parallel and keeps it updated', async () => {
    const { body: profile } = await http().post('/profiles').send({ name: 'shop' }).expect(201);
    expect(profile.mode).toBe('folder');

    // "log in" with the folder profile
    const login = await runJob({ profileId: profile._id, actions: [{ type: 'goto', url: `${base}/set?v=abc` }] });
    expect(login.job.status).toBe('done');

    // folder → database
    const { body: imported } = await http().post(`/profiles/${profile._id}/import-session`).expect(200);
    expect(imported).toMatchObject({ mode: 'session', sessionCookies: 1 });
    expect(imported.sessionSealed).toBeUndefined();
    const { body: list } = await http().get('/profiles').expect(200);
    expect(JSON.stringify(list)).not.toContain('sessionSealed');
    const stored = await app.get<Model<Profile>>(getModelToken(Profile.name)).findById(profile._id).lean();
    expect(stored!.sessionSealed).toMatch(/^v1:/);
    expect(stored!.sessionSealed).not.toContain('abc');

    // three tasks at the same time, same login
    const parallel = await echo(profile._id, [{ name: 'a' }, { name: 'b' }, { name: 'c' }], 3);
    expect(parallel.job.concurrency).toBe(3);
    expect(parallel.tasks.map((t: any) => t.result.cookies)).toEqual(['sid=abc', 'sid=abc', 'sid=abc']);

    // cookies changed by a task are saved back
    await runJob({ profileId: profile._id, actions: [{ type: 'goto', url: `${base}/set?v=new` }] });
    expect((await echo(profile._id)).tasks[0].result.cookies).toBe('sid=new');

    // clear → logged out
    const { body: cleared } = await http().delete(`/profiles/${profile._id}/session`).expect(200);
    expect(cleared.sessionCookies).toBe(0);
    expect((await echo(profile._id)).tasks[0].result.cookies).toBe('(none)');

    await http().delete(`/profiles/${profile._id}`).expect(204);
  }, 90_000);

  it('folder profiles still run one task at a time', async () => {
    const { body: profile } = await http().post('/profiles').send({ name: 'solo' }).expect(201);
    const run = await echo(profile._id, [{ name: 'a' }, { name: 'b' }], 2);
    expect(run.job.concurrency).toBe(1);
    expect(run.tasks.every((t: any) => t.status === 'done')).toBe(true);
    await http().delete(`/profiles/${profile._id}`).expect(204);
  }, 60_000);

  it('moves a profile folder when PROFILES_DIR changes', async () => {
    const { body: profile } = await http().post('/profiles').send({ name: 'moved' }).expect(201);
    const old = await mkdtemp(join(tmpdir(), 'old-profiles-'));
    const oldDir = join(old, profile._id);
    await mkdir(join(oldDir, 'Default', 'Network'), { recursive: true });
    await writeFile(join(oldDir, 'Default', 'Network', 'Cookies'), 'cookie-db');
    const model = app.get<Model<Profile>>(getModelToken(Profile.name));
    await model.updateOne({ _id: profile._id }, { userDataDir: oldDir });

    await app.get(ProfilesService).onApplicationBootstrap();

    const after = await model.findById(profile._id).lean();
    expect(after!.userDataDir).toBe(profile.userDataDir);
    expect(await readFile(join(profile.userDataDir, 'Default', 'Network', 'Cookies'), 'utf8')).toBe('cookie-db');
    await http().delete(`/profiles/${profile._id}`).expect(204);
    await rm(old, { recursive: true, force: true });
  });
});
