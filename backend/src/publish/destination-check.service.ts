import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Action } from '../actions/action.types.js';
import { JobsService } from '../jobs/jobs.service.js';
import { Task } from '../jobs/schemas.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { parseFacebookUrl } from './facebook-url.js';

export type DestinationState = 'ok' | 'not_member' | 'pending' | 'cannot_post' | 'needs_login' | 'not_found' | 'error';

export interface DestinationCheck {
  profileId: string;
  profileName: string;
  state: DestinationState;
  message: string;
  name?: string;
  taskId?: string;
}

/** How long one check may take before it is reported as an error. */
const CHECK_TIMEOUT_MS = 120_000;

/**
 * Read-only look at a Facebook Page / Group with each profile: logged in?
 * member? can it post (is there a composer)? Nothing is clicked except what
 * opens the page; nothing is posted.
 */
@Injectable()
export class DestinationCheckService {
  constructor(
    private readonly jobs: JobsService,
    private readonly profiles: ProfilesService,
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
  ) {}

  async check(url: string, profileIds: string[]): Promise<{ kind: 'page' | 'group'; url: string; results: DestinationCheck[] }> {
    const target = parseFacebookUrl(url);
    if ('error' in target) throw new BadRequestException(target.error);
    const profiles = await this.profiles.list();
    const started = await Promise.all(
      profileIds.map(async (profileId) => {
        const p = profiles.find((x) => String(x._id) === profileId);
        if (!p) return { profileId, profileName: '(đã xoá)', taskId: undefined };
        const job = await this.jobs.create({
          name: `Kiểm tra nơi đăng · ${p.name}`,
          kind: 'publish',
          category: 'publish',
          actions: inspectActions(target.url),
          inputs: [{ name: target.url }],
          profileId,
          headless: true,
          concurrency: 1,
          stepTimeout: 30_000,
        });
        const task = await this.tasks.findOne({ jobId: job._id }, { _id: 1 }).lean();
        return { profileId, profileName: p.name, taskId: task ? String(task._id) : undefined };
      }),
    );
    const results = await Promise.all(started.map((s) => this.result(s, target.kind)));
    return { kind: target.kind, url: target.url, results };
  }

  private async result(s: { profileId: string; profileName: string; taskId?: string }, kind: 'page' | 'group'): Promise<DestinationCheck> {
    const base = { profileId: s.profileId, profileName: s.profileName, taskId: s.taskId };
    if (!s.taskId) return { ...base, state: 'error', message: 'Không tìm thấy profile' };
    const end = Date.now() + CHECK_TIMEOUT_MS;
    let task = await this.tasks.findById(s.taskId).lean();
    while (task && !['done', 'failed', 'cancelled'].includes(task.status) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 1_000));
      task = await this.tasks.findById(s.taskId).lean();
    }
    if (!task || task.status !== 'done') return { ...base, state: 'error', message: task?.error?.message ?? 'Quá thời gian kiểm tra' };
    return { ...base, ...interpret((task.result as { page?: PageFacts })?.page, kind) };
  }
}

interface PageFacts {
  url: string;
  login: boolean;
  missing: boolean;
  name: string;
  join: boolean;
  pending: boolean;
  composer: boolean;
  switchToPage: boolean;
}

export function interpret(f: PageFacts | undefined, kind: 'page' | 'group'): Pick<DestinationCheck, 'state' | 'message' | 'name'> {
  if (!f) return { state: 'error', message: 'Không đọc được trang' };
  if (f.login) return { state: 'needs_login', message: 'Profile cần đăng nhập lại Facebook' };
  if (f.missing) return { state: 'not_found', message: 'Trang không tồn tại hoặc profile không xem được' };
  if (kind === 'group') {
    if (f.pending) return { state: 'pending', message: 'Đang chờ duyệt vào nhóm', name: f.name };
    if (f.join) return { state: 'not_member', message: 'Chưa tham gia nhóm', name: f.name };
    if (!f.composer) return { state: 'cannot_post', message: 'Là thành viên nhưng không thấy ô viết bài (nhóm có thể chỉ cho quản trị viên đăng)', name: f.name };
    return { state: 'ok', message: 'Là thành viên, đăng được', name: f.name };
  }
  if (f.switchToPage) return { state: 'ok', message: 'Quản lý Page (đăng sau khi chuyển sang Trang)', name: f.name };
  if (f.composer) return { state: 'ok', message: 'Đăng được trên Page', name: f.name };
  return { state: 'cannot_post', message: 'Không có quyền đăng trên Page này', name: f.name };
}

/** Opens the page and reads what is on it (no clicks). */
function inspectActions(url: string): Action[] {
  const script = String.raw`
const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const buttons = [...document.querySelectorAll('[role=button], a[role=link], button')].filter(vis);
const has = (re) => buttons.some((b) => re.test(((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '')).trim()));
const text = document.body.innerText || '';
return {
  url: location.href,
  login: /\/login|\/checkpoint/.test(location.pathname) || !!document.querySelector('form[action*="login"] input[name="email"]'),
  missing: /Nội dung này hiện không hiển thị|This content isn't available|Trang này không hiển thị/i.test(text),
  name: ((document.querySelector('h1') || {}).innerText || document.title || '').trim().slice(0, 120),
  join: has(/^(Tham gia nhóm|Join group)$/i),
  pending: has(/(Hủy yêu cầu|Huỷ yêu cầu|Cancel request)/i) || /Đã gửi yêu cầu|Request sent/i.test(text),
  composer: has(/(Viết gì đó|Bạn viết gì đi|Write something|Bạn đang nghĩ gì|What's on your mind|Tạo bài viết công khai|Create a public post)/i),
  switchToPage: has(/(Chuyển ngay|Switch now|Chuyển sang Trang)/i),
};`;
  return [
    { type: 'goto', url, waitUntil: 'domcontentloaded' },
    { type: 'sleep', ms: 4_000, jitter: 1_000 },
    { type: 'evaluate', script, as: 'page' },
  ];
}
