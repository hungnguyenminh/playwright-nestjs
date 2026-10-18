export type AiKind = 'script' | 'profile' | 'job';

export interface AiProposal {
  kind: AiKind;
  payload: Record<string, any>;
  errors: string[];
  warnings: string[];
}

export interface AiTurn {
  prompt: string;
  guide: string;
  proposal?: Record<string, unknown>;
}

export interface AiAssistRequest {
  kind: AiKind;
  prompt: string;
  history?: AiTurn[];
  currentForm?: Record<string, unknown>;
  snapshotUrl?: string;
  snapshotProfileId?: string;
  fixTaskId?: string;
}

export interface AiHandlers {
  status?(d: { message: string }): void;
  snapshot?(d: { url: string; title: string; screenshot: string }): void;
  text?(d: { delta: string }): void;
  proposal?(d: AiProposal): void;
  error?(d: { message: string }): void;
  done?(d: { usage: Record<string, number>; rounds: number; model: string }): void;
}

export function useAi() {
  const { api, base } = useApi();

  const status = () => api<{ configured: boolean; model: string }>('/ai/status');

  /** POST /ai/assist and dispatch its server-sent events until the stream ends. */
  async function assist(body: AiAssistRequest, on: AiHandlers, signal?: AbortSignal) {
    const res = await fetch(`${base}/ai/assist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => undefined);
      on.error?.({ message: apiErrorText({ data }) || `HTTP ${res.status}` });
      return;
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1] as keyof AiHandlers | undefined;
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event && data) (on[event] as ((d: unknown) => void) | undefined)?.(JSON.parse(data));
      }
    }
  }

  return { status, assist };
}
