import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { FakeAnthropic } from './fake-anthropic.js';

/**
 * The AI assistant end to end against a local fake of the Anthropic Messages
 * API (same SSE wire format), so the real SDK, our tool loop, validation and
 * the SSE endpoint all run without an API key. Needs MongoDB + Chrome.
 */

/** Parses a buffered SSE body into [event, data] pairs. */
function sse(text: string) {
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1] ?? '';
      const data = JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? 'null');
      return { event, data };
    });
}

const scriptInput = (actions: unknown) => ({
  name: 'Catalog titles',
  description: 'Reads product titles',
  actions_json: JSON.stringify(actions),
  default_vars_json: JSON.stringify({ url: 'https://example.com' }),
  emulation_json: '{}',
});

describe('AI assistant (e2e, fake Anthropic API)', () => {
  let app: INestApplication;
  const fake = new FakeAnthropic();
  const http = () => request(app.getHttpServer());

  async function assist(body: Record<string, unknown>) {
    const res = await http().post('/ai/assist').send(body).buffer(true).parse((r, cb) => {
      let data = '';
      r.on('data', (c: Buffer) => (data += c.toString()));
      r.on('end', () => cb(null, data));
    });
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    return sse(res.body as string);
  }

  beforeAll(async () => {
    await fake.start();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await http().put('/settings/ai').send({ token: '', baseUrl: '', model: '' });
    await app?.close();
    await fake.stop();
  });

  beforeEach(() => {
    fake.turns = [];
    fake.requests = [];
  });

  it('saves settings with the token encrypted and never returned', async () => {
    const { body } = await http()
      .put('/settings/ai')
      .send({ enabled: true, baseUrl: `${fake.url}/`, authType: 'bearer', token: 'sk-test-SECRET-9f3a', model: 'fake-model', effort: '' })
      .expect(200);
    expect(body).toMatchObject({ baseUrl: fake.url, authType: 'bearer', model: 'fake-model', hasToken: true, tokenHint: '9f3a', tokenSource: 'settings', configured: true });
    expect(JSON.stringify(body)).not.toContain('SECRET');

    const { body: test } = await http().post('/settings/ai/test').send({}).expect(200);
    expect(test).toMatchObject({ ok: true, reply: 'OK' });
    expect(fake.requests[0].headers.authorization).toBe('Bearer sk-test-SECRET-9f3a');
    expect(fake.requests[0].headers['x-api-key']).toBeUndefined();

    await http().put('/settings/ai').send({ baseUrl: 'ftp://nope' }).expect(400);
  });

  it('streams the guide, validates the proposal and lets the model fix its errors', async () => {
    fake.turns = [
      { text: '## Cách hoạt động\n1. Mở trang\n2. Lấy tiêu đề', tool: { name: 'propose_script', input: scriptInput([{ type: 'goto' }]) } },
      { text: 'Đã thêm url cho bước goto.', tool: { name: 'propose_script', input: scriptInput([{ type: 'goto', url: '{{url}}' }, { type: 'extract', selector: 'h1', as: 'title' }]) } },
    ];
    const events = await assist({ kind: 'script', prompt: 'Lấy tiêu đề trang', currentForm: { name: 'old' } });

    const text = events.filter((e) => e.event === 'text').map((e) => e.data.delta).join('');
    expect(text).toContain('## Cách hoạt động');
    expect(text).toContain('Đã thêm url');
    expect(events.some((e) => e.event === 'status' && /tự sửa/.test(e.data.message))).toBe(true);

    const proposal = events.find((e) => e.event === 'proposal')!.data;
    expect(proposal.errors).toEqual([]);
    expect(proposal.payload.actions).toHaveLength(2);
    expect(proposal.payload.defaultVars).toEqual({ url: 'https://example.com' });
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { rounds: 2 } });

    // What we sent: cached system prompt, strict tool, no fallback beta on a gateway, error round-trip.
    const [first, second] = fake.requests.map((r) => r.body);
    expect(first.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(first.tools[0]).toMatchObject({ name: 'propose_script', strict: true });
    expect(first.fallbacks).toBeUndefined();
    expect(first.output_config).toBeUndefined();
    expect(JSON.stringify(first.messages)).toContain('<current_form>');
    const toolResult = second.messages.at(-1).content[0];
    expect(toolResult).toMatchObject({ type: 'tool_result', is_error: true });
    expect(toolResult.content).toMatch(/url/);
  });

  it('reads the page first and sends its outline and screenshot', async () => {
    fake.turns = [{ text: 'Dùng selector .card .title', tool: { name: 'propose_script', input: scriptInput([{ type: 'extract', selector: '.card .title', multiple: true, as: 'titles' }]) } }];
    const events = await assist({ kind: 'script', prompt: 'Lấy tên sản phẩm', snapshotUrl: `${fake.url}/page` });
    const snap = events.find((e) => e.event === 'snapshot')!.data;
    expect(snap.url).toBe(`${fake.url}/page`);
    expect(snap.screenshot.length).toBeGreaterThan(1000);

    const content = fake.requests[0].body.messages.at(-1).content;
    expect(content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg' } });
    expect(content.at(-1).text).toMatch(/div\.card\s+×3/);
    expect(content.at(-1).text).toContain('input[name="q"]');
  }, 60_000);

  it('proposes a job against saved scripts/profiles and checks the ids', async () => {
    const { body: script } = await http()
      .post('/scripts')
      .send({ name: 'Titles', actions: [{ type: 'goto', url: '{{url}}' }] })
      .expect(201);
    fake.turns = [{
      text: 'Chạy script Titles cho 2 trang',
      tool: {
        name: 'propose_job',
        input: {
          source: 'script', script_id: script._id, actions_json: '', name: '', inputs_csv: 'name,url\nA,https://a.com\nB,https://b.com',
          vars_json: '', concurrency: 99, headless: false, profile_id: '', max_retries: 1, step_timeout_seconds: 30,
        },
      },
    }];
    const events = await assist({ kind: 'job', prompt: 'chạy Titles cho a.com và b.com' });
    const proposal = events.find((e) => e.event === 'proposal')!.data;
    expect(proposal.errors).toEqual([]);
    expect(proposal.payload).toMatchObject({ source: 'script', scriptId: script._id, taskCount: 2, concurrency: 50, headless: false });
    expect(JSON.stringify(fake.requests[0].body.messages)).toContain(`${script._id} | Titles`);
    await http().delete(`/scripts/${script._id}`).expect(204);
  });

  it('fixes a failed task with its error, log and screenshot, then retries with the latest script', async () => {
    const page = 'data:text/html,' + encodeURIComponent('<p>no button</p>');
    const { body: script } = await http()
      .post('/scripts')
      .send({ name: 'Broken', actions: [{ type: 'goto', url: page }, { type: 'click', selector: '#missing', timeout: 500 }] })
      .expect(201);
    const { body: job } = await http().post('/jobs').send({ scriptId: script._id }).expect(201);
    let task: any;
    for (let i = 0; i < 100; i++) {
      task = (await http().get(`/jobs/${job._id}/tasks`)).body.items[0];
      const j = (await http().get(`/jobs/${job._id}`)).body;
      if (task?.status === 'failed' && j.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(task.status).toBe('failed');

    const fixed = [{ type: 'goto', url: page }, { type: 'click', selector: '#missing', optional: true, timeout: 500 }];
    fake.turns = [{ text: '## Nguyên nhân\nKhông có #missing', tool: { name: 'propose_script', input: scriptInput(fixed) } }];
    const events = await assist({ kind: 'script', prompt: 'Sửa lỗi', fixTaskId: task._id });
    expect(events.find((e) => e.event === 'proposal')!.data.errors).toEqual([]);
    const content = fake.requests[0].body.messages.at(-1).content;
    expect(content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } });
    expect(content.at(-1).text).toMatch(/Failed step: 2 \(click\)/);

    await http().put(`/scripts/${script._id}`).send({ name: 'Broken', actions: fixed }).expect(200);
    await http().post(`/jobs/${job._id}/retry`).send({ useLatestScript: true }).expect(201);
    for (let i = 0; i < 100; i++) {
      const j = (await http().get(`/jobs/${job._id}`)).body;
      if (j.status === 'done') break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect((await http().get(`/jobs/${job._id}`)).body).toMatchObject({ status: 'done', actions: fixed });
    await http().delete(`/jobs/${job._id}`).expect(204);
    await http().delete(`/scripts/${script._id}`).expect(204);
  }, 60_000);

  it('reports when the assistant is not configured', async () => {
    await http().put('/settings/ai').send({ token: '' });
    const events = await assist({ kind: 'profile', prompt: 'profile cho shopee' });
    expect(events).toEqual([{ event: 'error', data: { message: expect.stringMatching(/chưa được cấu hình/) } }]);
    expect(fake.requests).toHaveLength(0);
  });
});
