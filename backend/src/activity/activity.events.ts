import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Events, type JobUpdatedEvent, type TaskUpdatedEvent } from '../common/events.js';
import { Job, Task } from '../jobs/schemas.js';
import { ActivityService } from './activity.service.js';

const JOB_LABEL: Record<string, string> = {
  crawl: 'Kéo dữ liệu',
  pipeline: 'Kéo → Đăng',
  publish: 'Đăng bài',
  script: 'Luồng script',
  login: 'Đăng nhập',
  manual: 'Chạy tay',
};
const JOB_STATUS: Record<string, string> = { done: 'xong', failed: 'lỗi', cancelled: 'bị huỷ' };
const PUB_STATUS: Record<string, string> = {
  published: 'đã đăng',
  pending_approval: 'đã gửi, chờ admin duyệt',
  failed: 'đăng lỗi',
  unknown: 'không rõ đã đăng chưa',
  skipped: 'bị bỏ qua',
  cancelled: 'bị huỷ',
};

/** What the app does on its own: runs finishing, tasks failing, publications posting. */
@Injectable()
export class ActivityEvents implements OnApplicationBootstrap {
  constructor(
    private readonly activity: ActivityService,
    @InjectModel(Job.name) private readonly jobs: Model<Job>,
    @InjectModel(Task.name) private readonly tasks: Model<Task>,
  ) {}

  onApplicationBootstrap() {
    this.activity.log({ actor: 'system', category: 'system', action: 'system.start', summary: 'Máy chủ khởi động' });
  }

  @OnEvent(Events.JobUpdated, { async: true })
  async onJob(e: JobUpdatedEvent) {
    const status = String(e.status ?? '');
    if (!JOB_STATUS[status]) return;
    const job = await this.jobs.findById(e._id, { name: 1, category: 1, totals: 1 }).lean();
    if (!job) return;
    this.activity.log({
      actor: 'system',
      level: status === 'failed' ? 'error' : 'info',
      category: job.category === 'publish' ? 'publish' : job.category === 'pipeline' || job.category === 'crawl' ? 'crawl' : 'job',
      action: `job.${status}`,
      summary: `${JOB_LABEL[job.category ?? 'manual'] ?? 'Job'} ${JOB_STATUS[status]}: ${job.name}`,
      target: { type: 'job', id: job._id, name: job.name },
      details: { totals: job.totals },
    });
  }

  @OnEvent(Events.TaskUpdated, { async: true })
  async onTask(e: TaskUpdatedEvent) {
    if (e.status !== 'failed') return;
    const task = await this.tasks.findById(e._id, { name: 1, error: 1, jobId: 1 }).lean();
    if (!task) return;
    const job = await this.jobs.findById(task.jobId, { name: 1 }).lean();
    this.activity.log({
      actor: 'system',
      level: 'error',
      category: 'job',
      action: 'task.failed',
      summary: `Task lỗi ở bước ${task.error?.stepPath ?? '?'} (${job?.name ?? ''} · ${task.name}): ${task.error?.message?.slice(0, 200) ?? ''}`,
      target: { type: 'task', id: task._id, name: task.name },
      details: { job: job?.name, error: task.error },
    });
  }

  @OnEvent(Events.PublicationUpdated, { async: true })
  onPublication(e: { _id: string; status?: string; platform?: string; url?: string; error?: string; postUrl?: string; campaignId: string }) {
    const label = PUB_STATUS[e.status ?? ''];
    if (!label) return;
    this.activity.log({
      actor: 'system',
      level: e.status === 'failed' || e.status === 'unknown' ? 'error' : 'info',
      category: 'publish',
      action: `publication.${e.status}`,
      summary: `Lượt đăng ${e.platform ?? ''}${e.url ? ` (${e.url})` : ''} ${label}${e.error ? `: ${e.error.slice(0, 200)}` : ''}`,
      target: { type: 'publication', id: e._id },
      details: { campaignId: e.campaignId, postUrl: e.postUrl, error: e.error },
    });
  }
}
