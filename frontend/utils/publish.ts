import type { CampaignStatus, Platform, PublicationStatus } from '~/types/api';

export const PLATFORM_ICON: Record<Platform, string> = { facebook: '📘', youtube: '▶️', tiktok: '🎵', threads: '🧵' };
export const PLATFORM_LABEL: Record<Platform, string> = { facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok', threads: 'Threads' };

type TagType = 'success' | 'warning' | 'info' | 'danger' | 'primary';

export const PUBLICATION_STATUS: Record<PublicationStatus, { label: string; type: TagType }> = {
  scheduled: { label: 'Đã lên lịch', type: 'info' },
  waiting: { label: 'Đang chờ', type: 'warning' },
  running: { label: 'Đang đăng', type: 'primary' },
  published: { label: 'Đã đăng', type: 'success' },
  pending_approval: { label: 'Chờ admin duyệt', type: 'success' },
  failed: { label: 'Lỗi', type: 'danger' },
  unknown: { label: 'Không rõ', type: 'danger' },
  skipped: { label: 'Bỏ qua', type: 'info' },
  cancelled: { label: 'Đã huỷ', type: 'info' },
};

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; type: TagType }> = {
  draft: { label: 'Nháp', type: 'info' },
  active: { label: 'Đang chạy', type: 'success' },
  paused: { label: 'Tạm dừng', type: 'warning' },
  done: { label: 'Xong', type: 'info' },
  cancelled: { label: 'Đã huỷ', type: 'info' },
};

export const destinationLabel = (d: { platform: Platform; kind: string; url?: string }) => {
  const where =
    d.kind === 'self'
      ? d.platform === 'youtube'
        ? 'Kênh của tài khoản'
        : 'Trang cá nhân'
      : `${d.kind === 'group' ? 'Nhóm' : 'Page'} ${(d.url ?? '')
          .replace(/^https?:\/\/((www|m|web)\.)?(facebook|fb)\.com\/(groups\/)?/i, '')
          .replace(/[?#].*$/, '')
          .replace(/\/+$/, '')}`;
  return `${PLATFORM_ICON[d.platform]} ${PLATFORM_LABEL[d.platform]} · ${where}`;
};

export const fmtMinutes = (m: number) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440} ngày` : m >= 60 && m % 60 === 0 ? `${m / 60} giờ` : `${m} phút`);

/** "+35′" when a publication was moved from its first planned time. */
export function movedBy(scheduledAt: string, originalAt: string) {
  const d = Math.round((new Date(scheduledAt).getTime() - new Date(originalAt).getTime()) / 60_000);
  return Math.abs(d) < 1 ? '' : `${d > 0 ? 'dời +' : 'dời '}${fmtMinutes(Math.abs(d)).replace(' phút', '′')}`;
}

/** Run history categories (Job.category). */
export const JOB_CATEGORY: Record<string, { label: string; icon: string; type: 'primary' | 'success' | 'warning' | 'info' | 'danger' }> = {
  crawl: { label: 'Kéo dữ liệu', icon: '📥', type: 'primary' },
  pipeline: { label: 'Kéo → Đăng', icon: '🔁', type: 'warning' },
  publish: { label: 'Đăng bài', icon: '📤', type: 'success' },
  script: { label: 'Luồng script', icon: '🧩', type: 'info' },
  login: { label: 'Đăng nhập', icon: '🔑', type: 'info' },
  manual: { label: 'Chạy tay', icon: '✋', type: 'info' },
};
