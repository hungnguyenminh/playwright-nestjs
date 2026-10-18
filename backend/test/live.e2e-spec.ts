import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

/** Needs MongoDB and Google Chrome, like app.e2e-spec.ts. */

const FORM = 'data:text/html,' + encodeURIComponent(
  `<body style="margin:0"><input id="q" style="position:absolute;left:100px;top:100px;width:200px;height:30px"></body>`,
);

describe('Live view and takeover (e2e)', () => {
  let app: INestApplication;
  let socket: Socket;
  const http = () => request(app.getHttpServer());

  async function firstTask(jobId: string, status: string) {
    for (let i = 0; i < 100; i++) {
      const { body } = await http().get(`/jobs/${jobId}/tasks`);
      if (body.items[0]?.status === status) return body.items[0];
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`task never became ${status}`);
  }

  const send = (e: Record<string, unknown>) =>
    socket.emitWithAck('input', e) as Promise<{ ok: boolean; error?: string }>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    socket = io(`http://localhost:${port}/live`, { transports: ['websocket'] });
    await new Promise<void>((r) => socket.once('connect', () => r()));
  });

  afterAll(async () => {
    socket?.close();
    await app?.close();
  });

  it('streams frames and replays mouse/keyboard input on a paused task', async () => {
    const { body: job } = await http()
      .post('/jobs')
      .send({
        actions: [
          { type: 'goto', url: FORM },
          { type: 'pause', message: 'type something' },
          { type: 'evaluate', script: 'return document.querySelector("#q").value', as: 'typed' },
        ],
      })
      .expect(201);
    const task = await firstTask(job._id, 'paused');

    const frame = new Promise<any>((r) => socket.once('task:frame', r));
    socket.emit('subscribe:task', { taskId: task._id, quality: 'high' });
    expect(await frame).toMatchObject({ taskId: task._id, width: 1366, height: 768 });

    expect(await send({ taskId: task._id, kind: 'mouse', action: 'down', x: 150, y: 115 })).toEqual({ ok: true });
    await send({ taskId: task._id, kind: 'mouse', action: 'up', x: 150, y: 115 });
    for (const key of ['a', 'b', 'Backspace', 'Shift', 'C', ' ']) {
      await send({ taskId: task._id, kind: 'key', action: 'down', key });
      await send({ taskId: task._id, kind: 'key', action: 'up', key });
    }
    // Non-US characters fall back to text insertion.
    expect(await send({ taskId: task._id, kind: 'key', action: 'down', key: 'ă' })).toEqual({ ok: true });
    await send({ taskId: task._id, kind: 'text', text: 'n' });

    await http().post(`/tasks/${task._id}/resume`).expect(202);
    const done = await firstTask(job._id, 'done');
    expect(done.result.typed).toBe('aC ăn');
    socket.emit('unsubscribe', { taskId: task._id });
    await http().delete(`/jobs/${job._id}`).expect(204);
  }, 60_000);

  it('pauses a running task on request and only then accepts input', async () => {
    const { body: job } = await http()
      .post('/jobs')
      .send({
        actions: [
          { type: 'goto', url: FORM },
          { type: 'repeat', times: 100, actions: [{ type: 'sleep', ms: 100 }] },
        ],
      })
      .expect(201);
    const task = await firstTask(job._id, 'running');

    expect(await send({ taskId: task._id, kind: 'text', text: 'x' })).toEqual({
      ok: false,
      error: 'Task is not paused',
    });
    await http().post(`/tasks/${task._id}/pause`).expect(202);
    const paused = await firstTask(job._id, 'paused');
    expect(paused.pauseMessage).toBe('Paused from the UI');
    expect((await send({ taskId: task._id, kind: 'text', text: 'x' })).ok).toBe(true);

    await http().post(`/tasks/${task._id}/cancel`).expect(202);
    await firstTask(job._id, 'cancelled');
    for (let i = 0; i < 50 && (await http().get(`/jobs/${job._id}`)).body.status !== 'cancelled'; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await http().delete(`/jobs/${job._id}`).expect(204);
  }, 60_000);
});
