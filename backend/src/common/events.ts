import type { StepStatus } from '../actions/run-context.js';

/** Internal event names (EventEmitter2) bridged to Socket.IO by LiveGateway. */
export const Events = {
  JobUpdated: 'job.updated',
  TaskUpdated: 'task.updated',
  TaskLog: 'task.log',
  /** A running task switched to another tab, or got/lost its page. */
  TaskPage: 'task.page',
  /** A publishing campaign's publication changed (status, account, time…). */
  PublicationUpdated: 'publication.updated',
} as const;

export interface JobUpdatedEvent {
  _id: string;
  [field: string]: unknown;
}

export interface TaskUpdatedEvent {
  _id: string;
  jobId: string;
  [field: string]: unknown;
}

export interface TaskLogEvent {
  taskId: string;
  jobId: string;
  attempt: number;
  path: string;
  type: string;
  label?: string;
  status: StepStatus;
  durationMs: number;
  message?: string;
  ts: Date;
}

export interface TaskPageEvent {
  taskId: string;
}
