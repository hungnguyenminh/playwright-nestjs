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

export type JobCategory = 'crawl' | 'pipeline' | 'publish' | 'script' | 'login' | 'manual';

export interface Job {
  category?: JobCategory;
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
  /** Set by publishing when the site asked to log in again. */
  health?: { needsLogin?: boolean; lastError?: string; checkedAt?: string };
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
  kind: 'script' | 'sources' | 'pipeline';
  autoRun?: AutoRun;
  generate?: GenerateSpec;
  campaignId?: string;
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

// ---- publishing ------------------------------------------------------------
export type Platform = 'facebook' | 'youtube' | 'tiktok' | 'threads';
export type PostStatus = 'draft' | 'ready' | 'archived';

export interface Media {
  _id: string;
  name: string;
  mime: string;
  kind: 'image' | 'video';
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  sourceUrl?: string;
  createdAt: string;
}

export interface PlatformOptions {
  format?: string;
  content?: string;
  privacy?: string;
  firstComment?: string;
  title?: string;
  description?: string;
  tags?: string[];
  thumbnailId?: string;
  playlist?: string;
  madeForKids?: boolean;
  premiereAt?: string;
  caption?: string;
  coverId?: string;
  allowComment?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  parts?: string[];
  topic?: string;
  replyControl?: string;
}

export interface PlatformInfo {
  platform: Platform;
  label: string;
  formats: Array<{ value: string; label: string; hint: string }>;
  textMax: number;
  options: Record<string, { label: string; values?: Array<{ value: string; label: string }> }>;
  limits: Record<string, number>;
}

export interface PostCheck {
  platform: Platform;
  format: string | null;
  auto: boolean;
  text: string;
  counts: Record<string, { used: number; max: number }>;
  errors: string[];
  warnings: string[];
}

export interface Post {
  _id: string;
  title: string;
  content: string;
  hashtags: string[];
  mediaIds: string[];
  link?: string;
  platforms: Partial<Record<Platform, PlatformOptions>>;
  status: PostStatus;
  tags: string[];
  origin: 'manual' | 'ai';
  flowId?: string;
  usedCount: number;
  lastPublishedAt?: string;
  createdAt: string;
  updatedAt: string;
  media: Media[];
  checks: Partial<Record<Platform, PostCheck>>;
}

export type PublicationStatus = 'scheduled' | 'waiting' | 'running' | 'published' | 'pending_approval' | 'failed' | 'unknown' | 'skipped' | 'cancelled';
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'done' | 'cancelled';

export interface Destination {
  platform: Platform;
  kind: 'self' | 'page' | 'group';
  url?: string;
  profileIds: string[];
  accountMode: 'all' | 'rotate';
  rotate?: { strategy: 'roundRobin' | 'random' | 'leastRecent'; startOffset?: number };
  limits: { minGapPerProfileMinutes: number; maxPerProfilePerDay: number; noRepeatPostDays: number };
}

export type Schedule =
  | { mode: 'once'; at?: string }
  | { mode: 'slots'; slots: Array<{ at: string; postId?: string }> }
  | { mode: 'interval'; startAt: string; every: number; unit: 'minute' | 'hour' | 'day'; count?: number; jitterMinutes?: number; activeHours?: { from: string; to: string } };

export interface CampaignForm {
  name: string;
  destinations: Destination[];
  postSource: { type: 'list'; postIds: string[]; separate?: Record<string, string[]> } | { type: 'flow'; flowId: string };
  order: 'sequential' | 'random';
  whenExhausted: 'stop' | 'loop' | 'wait';
  assignment: 'same' | 'rotate' | 'separate';
  staggerMinutes: number;
  minGapMinutes: number;
  schedule: Schedule;
  catchUp: 'shift' | 'skip';
  headless: boolean;
  dryRun: boolean;
}

export interface Campaign extends CampaignForm {
  _id: string;
  status: CampaignStatus;
  flowId?: string;
  log: Array<{ at: string; message: string }>;
  createdAt: string;
  updatedAt: string;
  totals?: Partial<Record<PublicationStatus, number>>;
  nextAt?: string | null;
}

export interface Publication {
  _id: string;
  campaignId: string;
  campaignName?: string;
  slot: number;
  destIndex: number;
  lane: string;
  laneIndex: number;
  platform: Platform;
  kind: string;
  url?: string;
  profileId?: string;
  plannedProfileId?: string;
  profileName?: string;
  postId?: string;
  plannedPostId?: string;
  postTitle?: string;
  pinned: boolean;
  attempts: Array<{ profileId: string; error?: string; at: string }>;
  scheduledAt: string;
  originalAt: string;
  status: PublicationStatus;
  waitReason?: string;
  jobId?: string;
  taskId?: string;
  postUrl?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface CampaignPreview {
  errors: string[];
  warnings: string[];
  publications: Array<{ slot: number; destIndex: number; lane: string; scheduledAt: string; plannedProfileId?: string; plannedPostId?: string }>;
}

export interface AutoRun {
  enabled: boolean;
  every: number;
  unit: 'hour' | 'day';
  activeHours?: { from: string; to: string };
  nextRunAt?: string;
}

export interface GenerateSpec {
  mode: 'perRecord' | 'digest';
  digestSize?: number;
  prompt: string;
  tone?: string;
  length?: 'short' | 'medium' | 'long';
  language?: string;
  platforms: Platform[];
  maxPostsPerRun: number;
  filter?: { datasets?: string[]; q?: string; requireImage?: boolean };
  attachImage: boolean;
  approval: 'review' | 'auto';
}

export interface FlowRun {
  _id: string;
  flowId: string;
  runId: string;
  status: 'crawling' | 'generating' | 'done' | 'failed';
  trigger: 'manual' | 'auto';
  jobs: number;
  newRecords: number;
  postsCreated: number;
  skipped: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}
