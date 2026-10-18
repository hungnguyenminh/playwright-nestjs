import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { CDPSession, Page } from 'playwright';
import type { Namespace } from 'socket.io';
import { errorMessage } from '../actions/handlers/handler.js';
import { Events, type TaskPageEvent } from '../common/events.js';
import { JobRunnerService } from '../jobs/job-runner.service.js';

export type Quality = 'low' | 'high';

/** Grid thumbnails vs. the big task view. */
const PRESETS: Record<Quality, Record<string, unknown>> = {
  low: { format: 'jpeg', quality: 40, maxWidth: 640, maxHeight: 400, everyNthFrame: 2 },
  high: { format: 'jpeg', quality: 70, maxWidth: 1600, maxHeight: 1000, everyNthFrame: 1 },
};

export interface FramePayload {
  taskId: string;
  data: string;
  width: number;
  height: number;
  ts: number;
}

interface Cast {
  taskId: string;
  /** socket id → requested quality */
  watchers: Map<string, Quality>;
  page?: Page;
  quality?: Quality;
  session?: CDPSession;
  lastFrame?: FramePayload;
  /** Start/stop calls are serialized per task. */
  chain: Promise<void>;
}

/**
 * Streams a running task's current tab as JPEG frames over CDP
 * (Page.startScreencast), only while at least one socket watches it.
 * Works for headless and headed Chrome alike.
 */
@Injectable()
export class ScreencastService {
  private readonly logger = new Logger(ScreencastService.name);
  private readonly casts = new Map<string, Cast>();
  server?: Namespace;

  constructor(private readonly runner: JobRunnerService) {}

  watch(taskId: string, socketId: string, quality: Quality) {
    let cast = this.casts.get(taskId);
    if (!cast) {
      cast = { taskId, watchers: new Map(), chain: Promise.resolve() };
      this.casts.set(taskId, cast);
    }
    cast.watchers.set(socketId, quality);
    if (cast.lastFrame) this.server?.to(socketId).emit('task:frame', cast.lastFrame);
    this.sync(cast);
  }

  unwatch(taskId: string, socketId: string) {
    const cast = this.casts.get(taskId);
    if (!cast?.watchers.delete(socketId)) return;
    this.sync(cast);
  }

  unwatchAll(socketId: string) {
    for (const taskId of this.casts.keys()) this.unwatch(taskId, socketId);
  }

  @OnEvent(Events.TaskPage)
  onTaskPage({ taskId }: TaskPageEvent) {
    const cast = this.casts.get(taskId);
    if (cast) this.sync(cast);
  }

  private sync(cast: Cast) {
    cast.chain = cast.chain
      .then(() => this.apply(cast))
      .catch((err) => this.logger.debug(`Screencast ${cast.taskId}: ${errorMessage(err)}`));
  }

  private async apply(cast: Cast) {
    const page = cast.watchers.size
      ? this.runner.getActive(cast.taskId)?.page
      : undefined;
    const quality: Quality = [...cast.watchers.values()].includes('high') ? 'high' : 'low';
    if (page && cast.page === page && cast.quality === quality && cast.session) return;

    await this.stop(cast);
    if (!cast.watchers.size) {
      this.casts.delete(cast.taskId);
      return;
    }
    if (!page || page.isClosed()) return;

    const session = await page.context().newCDPSession(page);
    Object.assign(cast, { session, page, quality });
    session.on('Page.screencastFrame', ({ data, sessionId, metadata }) => {
      void session.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
      this.emitFrame(cast, data, metadata.deviceWidth, metadata.deviceHeight);
    });
    await session.send('Page.startScreencast', PRESETS[quality]);

    // The screencast only emits when the page repaints; a static page would
    // stay blank, so seed the view with one snapshot.
    const seeded = cast.lastFrame?.ts;
    const { data } = await session.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: PRESETS[quality].quality as number,
    });
    if (cast.session === session && cast.lastFrame?.ts === seeded) {
      const size = page.viewportSize();
      this.emitFrame(cast, data, size?.width ?? 0, size?.height ?? 0);
    }
  }

  private emitFrame(cast: Cast, data: string, width: number, height: number) {
    cast.lastFrame = { taskId: cast.taskId, data, width, height, ts: Date.now() };
    this.server?.to([...cast.watchers.keys()]).emit('task:frame', cast.lastFrame);
  }

  private async stop(cast: Cast) {
    const { session } = cast;
    cast.session = cast.page = cast.quality = undefined;
    if (!session) return;
    await session.send('Page.stopScreencast').catch(() => undefined);
    await session.detach().catch(() => undefined);
  }
}
