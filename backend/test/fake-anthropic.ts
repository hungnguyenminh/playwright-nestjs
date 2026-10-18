import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Local fake of the Anthropic Messages API (same SSE wire format) for tests. */
export interface FakeTurn {
  text: string;
  tool?: { name: string; input: Record<string, unknown> };
}

export class FakeAnthropic {
  server: Server;
  url = '';
  turns: FakeTurn[] = [];
  requests: Array<{ headers: IncomingMessage['headers']; body: any }> = [];

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop() {
    return new Promise((r) => this.server.close(r));
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET' && req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<h1>Catalog</h1><input name="q" placeholder="Search">
        <div class="card"><a class="title" href="/1">First product here</a></div>
        <div class="card"><a class="title" href="/2">Second product here</a></div>
        <div class="card"><a class="title" href="/3">Third product here</a></div>`);
      return;
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    this.requests.push({ headers: req.headers, body });

    if (!body.stream) {
      // settings "test connection"
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_t', type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 1 },
      }));
      return;
    }

    const turn = this.turns.shift() ?? { text: 'no more turns' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (event: string, data: object) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
    send('message_start', {
      message: {
        id: `msg_${this.requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [],
        stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 50 },
      },
    });
    send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    for (const piece of turn.text.match(/.{1,12}/gs) ?? []) {
      send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } });
    }
    send('content_block_stop', { index: 0 });
    if (turn.tool) {
      send('content_block_start', { index: 1, content_block: { type: 'tool_use', id: `toolu_${this.requests.length}`, name: turn.tool.name, input: {} } });
      const json = JSON.stringify(turn.tool.input);
      for (let i = 0; i < json.length; i += 40) {
        send('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: json.slice(i, i + 40) } });
      }
      send('content_block_stop', { index: 1 });
    }
    send('message_delta', { delta: { stop_reason: turn.tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 42 } });
    send('message_stop', {});
    res.end();
  }
}

