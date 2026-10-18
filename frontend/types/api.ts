/** Mirrors the backend DTOs/schemas (backend/src/jobs/schemas.ts etc.). */
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type TaskStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
export type Totals = Record<TaskStatus, number>;
export type StepStatus = 'ok' | 'error' | 'skipped';

export type Action = { type: string; [key: string]: unknown };

export interface Emulation {
  viewport?: { width: number; height: number };
  userAgent?: string;
  locale?: string;
  timezoneId?: string;
  proxy?: { server: string; username?: string; password?: string };
  [key: string]: unknown;
}

export interface Script {
  _id: string;
  name: string;
  description: string;
  actions?: Action[];
  defaultVars: Record<string, unknown>;
  emulation: Emulation;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  _id: string;
  name: string;
  scriptId?: string;
  actions?: Action[];
  profileId?: string;
  status: JobStatus;
  concurrency: number;
  headless: boolean;
  maxRetries: number;
  stepTimeout: number;
  totals: Totals;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface TaskError {
  stepPath?: string;
  actionType?: string;
  message: string;
  screenshot?: string;
}

export interface Task {
  _id: string;
  jobId: string;
  index: number;
  name: string;
  vars: Record<string, unknown>;
  status: TaskStatus;
  attempt: number;
  currentUrl?: string;
  currentStep?: string | null;
  pauseMessage?: string | null;
  error?: TaskError | null;
  result?: Record<string, unknown> | null;
  startedAt?: string;
  finishedAt?: string | null;
}

export interface TaskLog {
  _id?: string;
  attempt: number;
  path: string;
  type: string;
  label?: string;
  status: StepStatus;
  durationMs: number;
  message?: string;
  ts: string;
}

export interface Artifact {
  _id: string;
  kind: 'screenshot' | 'pdf' | 'download';
  name: string;
  size: number;
  mime: string;
  createdAt: string;
}

export interface Profile {
  _id: string;
  name: string;
  notes: string;
  userDataDir: string;
  emulation: Emulation;
  proxy?: Emulation['proxy'];
  lastUsedAt?: string;
  inUse?: boolean;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface Frame {
  taskId: string;
  data: string;
  width: number;
  height: number;
  ts: number;
}

export interface PoolStats {
  maxConcurrency: number;
  activeContexts: number;
  queued: number;
  browsers: number;
}

/** Live patches: `_id` plus whatever fields changed. */
export type JobPatch = Partial<Job> & { _id: string };
export type TaskPatch = Partial<Task> & { _id: string; jobId: string };

export const FINISHED: TaskStatus[] = ['done', 'failed', 'cancelled'];

export const totalOf = (t: Totals) => Object.values(t).reduce((a, b) => a + b, 0);
