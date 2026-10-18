import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import { errorMessage } from '../actions/handlers/handler.js';
import { JobRunnerService } from '../jobs/job-runner.service.js';

type Button = 'left' | 'right' | 'middle';

/** Coordinates are CSS pixels of the page viewport (the frame's width/height). */
export type InputEvent =
  | { taskId: string; kind: 'mouse'; action: 'move' | 'down' | 'up'; x: number; y: number; button?: Button; clickCount?: number }
  | { taskId: string; kind: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { taskId: string; kind: 'key'; action: 'down' | 'up'; key: string }
  | { taskId: string; kind: 'text'; text: string };

export interface InputResult {
  ok: boolean;
  error?: string;
}

const BUTTONS = new Set<Button>(['left', 'right', 'middle']);

/**
 * Replays mouse/keyboard input from the live view onto a task's page. Only
 * allowed while the task is paused, so the user never races the script.
 */
@Injectable()
export class TakeoverService {
  /** Events of one task are applied in order. */
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly runner: JobRunnerService) {}

  handle(e: InputEvent): Promise<InputResult> {
    const entry = this.runner.getActive(e?.taskId);
    if (!entry?.page || !entry.resume) {
      return Promise.resolve({ ok: false, error: 'Task is not paused' });
    }
    const page = entry.page;
    const next = (this.chains.get(e.taskId) ?? Promise.resolve())
      .then(() => this.apply(page, e))
      .then(
        () => ({ ok: true }),
        (err) => ({ ok: false, error: errorMessage(err) }),
      );
    this.chains.set(e.taskId, next);
    void next.finally(() => {
      if (this.chains.get(e.taskId) === next) this.chains.delete(e.taskId);
    });
    return next;
  }

  private async apply(page: Page, e: InputEvent) {
    if (page.isClosed()) throw new Error('Page is closed');
    switch (e.kind) {
      case 'mouse': {
        const button = BUTTONS.has(e.button as Button) ? e.button : 'left';
        await page.mouse.move(Number(e.x), Number(e.y));
        if (e.action === 'down') await page.mouse.down({ button, clickCount: e.clickCount ?? 1 });
        if (e.action === 'up') await page.mouse.up({ button, clickCount: e.clickCount ?? 1 });
        return;
      }
      case 'wheel':
        await page.mouse.move(Number(e.x), Number(e.y));
        await page.mouse.wheel(Number(e.dx) || 0, Number(e.dy) || 0);
        return;
      case 'key':
        return this.key(page, e.action, String(e.key));
      case 'text':
        await page.keyboard.insertText(String(e.text));
        return;
      default:
        throw new Error('Unknown input');
    }
  }

  /**
   * `key` is the browser's KeyboardEvent.key. Playwright knows the US layout
   * names; any other single character (e.g. "ă", "€") is inserted as text.
   */
  private async key(page: Page, action: 'down' | 'up', key: string) {
    try {
      if (action === 'down') await page.keyboard.down(key);
      else await page.keyboard.up(key);
    } catch (err) {
      if (!/Unknown key/i.test(errorMessage(err))) throw err;
      if (action === 'down' && [...key].length === 1) await page.keyboard.insertText(key);
      // Dead keys, IME "Process", media keys...: nothing sensible to replay.
    }
  }
}
