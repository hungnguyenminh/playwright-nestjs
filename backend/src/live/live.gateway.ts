import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import {
  Events,
  type JobUpdatedEvent,
  type TaskLogEvent,
  type TaskUpdatedEvent,
} from '../common/events.js';
import { Quality, ScreencastService } from './screencast.service.js';
import { type InputEvent, TakeoverService } from './takeover.service.js';

const JOBS_ROOM = 'jobs';

/**
 * Socket.IO namespace /live.
 *  client → server: subscribe:jobs, subscribe:job {jobId},
 *                   subscribe:task {taskId, quality?, frames?}, unsubscribe {jobId?|taskId?|jobs?},
 *                   input {taskId, kind, ...} (takeover, paused tasks only; acked with {ok, error?})
 *  server → client: job:update, task:update, task:log, task:frame
 */
@WebSocketGateway({ namespace: '/live', cors: { origin: true } })
export class LiveGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer() server: Namespace;

  constructor(
    private readonly screencast: ScreencastService,
    private readonly takeover: TakeoverService,
  ) {}

  afterInit(server: Namespace) {
    this.screencast.server = server;
  }

  handleDisconnect(client: Socket) {
    this.screencast.unwatchAll(client.id);
  }

  /** Every job's updates (jobs list, dashboard). */
  @SubscribeMessage('subscribe:jobs')
  subscribeJobs(@ConnectedSocket() client: Socket) {
    void client.join(JOBS_ROOM);
  }

  /** Job + all its task updates (not logs or frames). */
  @SubscribeMessage('subscribe:job')
  subscribeJob(@ConnectedSocket() client: Socket, @MessageBody() body: { jobId: string }) {
    void client.join(`job:${body.jobId}`);
  }

  /** Task updates + step logs, and live frames unless `frames: false`. */
  @SubscribeMessage('subscribe:task')
  subscribeTask(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { taskId: string; quality?: Quality; frames?: boolean },
  ) {
    void client.join(`task:${body.taskId}`);
    if (body.frames !== false) {
      this.screencast.watch(body.taskId, client.id, body.quality === 'high' ? 'high' : 'low');
    }
  }

  @SubscribeMessage('unsubscribe')
  unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { jobId?: string; taskId?: string; jobs?: boolean },
  ) {
    if (body.jobs) void client.leave(JOBS_ROOM);
    if (body.jobId) void client.leave(`job:${body.jobId}`);
    if (body.taskId) {
      void client.leave(`task:${body.taskId}`);
      this.screencast.unwatch(body.taskId, client.id);
    }
  }

  /** Mouse/keyboard from the live view; the ack tells the client if it was applied. */
  @SubscribeMessage('input')
  input(@MessageBody() body: InputEvent) {
    return this.takeover.handle(body);
  }

  @OnEvent(Events.JobUpdated)
  onJob(e: JobUpdatedEvent) {
    this.server.to([JOBS_ROOM, `job:${e._id}`]).emit('job:update', e);
  }

  @OnEvent(Events.TaskUpdated)
  onTask(e: TaskUpdatedEvent) {
    this.server.to([`job:${e.jobId}`, `task:${e._id}`]).emit('task:update', e);
  }

  @OnEvent(Events.TaskLog)
  onLog(e: TaskLogEvent) {
    this.server.to(`task:${e.taskId}`).emit('task:log', e);
  }

  /** Publishing views listen in the jobs room (they already subscribe to it). */
  @OnEvent(Events.PublicationUpdated)
  onPublication(e: { _id: string; campaignId: string }) {
    this.server.to(JOBS_ROOM).emit('publication:update', e);
  }
}
