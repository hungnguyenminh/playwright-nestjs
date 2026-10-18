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
  flowId?: string;
  /** Jobs started together by one run of a source flow. */
  runId?: string;
  source?: SourceType;
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
  /** folder = Chrome user-data dir (one task at a time); session = cookies in the database (parallel). */
  mode: 'folder' | 'session';
  sessionCookies?: number;
  sessionUpdatedAt?: string;
  /** Page last used to log in with this profile. */
  loginUrl?: string;
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

/** A saved "Luồng": profile (optional) + script + job settings. */
export type SourceType = 'website' | 'facebook' | 'google' | 'youtube' | 'tiktok' | 'threads' | 'shopee';

export interface SourceSpec {
  type: SourceType;
  /** Links (website, facebook) or keywords (the others). */
  targets: string[];
  /** Website only. */
  keywords?: string[];
  limit?: number;
  detail?: boolean;
  profileId?: string;
}

export interface SourceInfo {
  type: SourceType;
  label: string;
  target: 'link' | 'keyword';
  placeholder: string;
  login: 'required' | 'recommended' | 'no';
  loginUrl?: string;
  note: string;
}

export interface SourceCatalog {
  defaultLimit: number;
  maxLimit: number;
  sources: SourceInfo[];
}

export interface Flow {
  _id: string;
  name: string;
  description: string;
  kind: 'script' | 'sources';
  profileId?: string;
  scriptId?: string;
  sources: SourceSpec[];
  inputsText: string;
  vars: Record<string, unknown>;
  concurrency: number;
  headless: boolean;
  maxRetries: number;
  /** Seconds. */
  stepTimeout: number;
  runs: number;
  lastRunAt?: string;
  lastJobId?: string;
  lastRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FlowListItem extends Flow {
  scriptName: string;
  profileName: string;
  lastJob: Pick<Job, '_id' | 'status' | 'totals'> | null;
}

export type ScopeType = 'flow' | 'script' | 'job';

export interface DatasetSummary {
  scope: string;
  scopeType: ScopeType;
  scopeName: string;
  dataset: string;
  count: number;
  lastSeenAt: string;
}

export interface DataRecord {
  _id: string;
  data: Record<string, unknown>;
  jobId: string;
  taskId: string;
  taskName: string;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
}
