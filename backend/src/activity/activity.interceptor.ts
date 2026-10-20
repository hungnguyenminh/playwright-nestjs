import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { ActivityService } from './activity.service.js';

/** Changes made through the API, with a readable Vietnamese line. Unlisted routes are logged as "METHOD path". */
const ROUTES: Record<string, { category: string; summary: string }> = {
  'POST /flows': { category: 'flow', summary: 'Tạo luồng' },
  'PUT /flows/:id': { category: 'flow', summary: 'Sửa luồng' },
  'DELETE /flows/:id': { category: 'flow', summary: 'Xoá luồng' },
  'POST /flows/:id/run': { category: 'flow', summary: 'Chạy luồng' },
  'POST /flows/:id/auto-run': { category: 'flow', summary: 'Bật / tắt tự chạy luồng' },
  'POST /jobs': { category: 'job', summary: 'Tạo job' },
  'POST /jobs/:id/cancel': { category: 'job', summary: 'Huỷ job' },
  'POST /jobs/:id/retry': { category: 'job', summary: 'Chạy lại task lỗi' },
  'DELETE /jobs/:id': { category: 'job', summary: 'Xoá job' },
  'POST /tasks/:id/cancel': { category: 'job', summary: 'Huỷ task' },
  'POST /tasks/:id/pause': { category: 'job', summary: 'Tạm dừng task' },
  'POST /tasks/:id/resume': { category: 'job', summary: 'Tiếp tục task' },
  'POST /scripts': { category: 'script', summary: 'Tạo script' },
  'PUT /scripts/:id': { category: 'script', summary: 'Sửa script' },
  'DELETE /scripts/:id': { category: 'script', summary: 'Xoá script' },
  'POST /profiles': { category: 'profile', summary: 'Tạo profile' },
  'PUT /profiles/:id': { category: 'profile', summary: 'Sửa profile' },
  'DELETE /profiles/:id': { category: 'profile', summary: 'Xoá profile' },
  'POST /profiles/:id/import-session': { category: 'profile', summary: 'Chuyển phiên đăng nhập vào database' },
  'DELETE /profiles/:id/session': { category: 'profile', summary: 'Xoá phiên đăng nhập trong database' },
  'POST /profiles/:id/health/clear': { category: 'profile', summary: 'Bỏ đánh dấu "cần đăng nhập lại"' },
  'POST /posts': { category: 'post', summary: 'Tạo bài viết' },
  'PUT /posts/:id': { category: 'post', summary: 'Sửa bài viết' },
  'DELETE /posts/:id': { category: 'post', summary: 'Xoá bài viết' },
  'POST /posts/:id/duplicate': { category: 'post', summary: 'Nhân bản bài viết' },
  'POST /posts/bulk-status': { category: 'post', summary: 'Đổi trạng thái nhiều bài' },
  'POST /posts/generate': { category: 'ai', summary: 'AI viết bài từ dữ liệu' },
  'POST /media': { category: 'post', summary: 'Tải media lên' },
  'POST /media/from-url': { category: 'post', summary: 'Tải ảnh từ link' },
  'DELETE /media/:id': { category: 'post', summary: 'Xoá media' },
  'POST /campaigns': { category: 'campaign', summary: 'Tạo lịch đăng' },
  'PUT /campaigns/:id': { category: 'campaign', summary: 'Sửa lịch đăng' },
  'DELETE /campaigns/:id': { category: 'campaign', summary: 'Xoá lịch đăng' },
  'POST /campaigns/:id/activate': { category: 'campaign', summary: 'Kích hoạt lịch đăng' },
  'POST /campaigns/:id/pause': { category: 'campaign', summary: 'Tạm dừng lịch đăng' },
  'POST /campaigns/:id/resume': { category: 'campaign', summary: 'Tiếp tục lịch đăng' },
  'POST /campaigns/:id/cancel': { category: 'campaign', summary: 'Huỷ lịch đăng' },
  'PUT /publications/:id': { category: 'publish', summary: 'Đổi giờ / bài của lượt đăng' },
  'POST /publications/:id/skip': { category: 'publish', summary: 'Bỏ qua lượt đăng' },
  'POST /publications/:id/retry': { category: 'publish', summary: 'Đăng lại lượt đăng' },
  'POST /publications/:id/mark-published': { category: 'publish', summary: 'Đánh dấu lượt đăng là đã đăng' },
  'POST /publish/now': { category: 'publish', summary: 'Đăng ngay' },
  'POST /publish/test': { category: 'publish', summary: 'Đăng thử' },
  'POST /publish/check-destination': { category: 'publish', summary: 'Kiểm tra nơi đăng bằng profile' },
  'PUT /publish/selectors/:key': { category: 'selector', summary: 'Sửa bộ chọn của bộ đăng' },
  'POST /publish/selectors/:key/revert': { category: 'selector', summary: 'Khôi phục bộ chọn của bộ đăng' },
  'POST /publish/selectors/:key/ai-fix': { category: 'selector', summary: 'Nhờ AI sửa bộ chọn của bộ đăng' },
  'POST /sources/test': { category: 'crawl', summary: 'Chạy thử nguồn' },
  'DELETE /data/records': { category: 'data', summary: 'Xoá bộ dữ liệu' },
  'DELETE /data/records/:id': { category: 'data', summary: 'Xoá một dòng dữ liệu' },
  'PUT /settings/ai': { category: 'settings', summary: 'Đổi cài đặt AI' },
  'POST /settings/ai/test': { category: 'settings', summary: 'Kiểm tra kết nối AI' },
  'POST /ai/assist': { category: 'ai', summary: 'Hỏi trợ lý AI' },
};

/** POST requests that only read or check something: not worth a log line. */
const SKIP = new Set([
  'POST /posts/check',
  'POST /publish/parse-destination',
  'POST /campaigns/preview',
  'POST /sources/preview',
  'POST /actions/validate',
  'POST /settings/ai/models',
  'GET /activity',
]);

/**
 * Logs every API request that changes something (POST / PUT / PATCH / DELETE):
 * what, on which object, the request body (secrets masked), the result and
 * how long it took. Failures are logged too.
 */
@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(private readonly activity: ActivityService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next.handle();
    const routePath = (req.route as { path?: string } | undefined)?.path ?? req.path;
    const key = `${req.method} ${routePath}`;
    if (SKIP.has(key)) return next.handle();
    const known = ROUTES[key];
    const started = Date.now();
    const base = {
      actor: 'user' as const,
      category: known?.category ?? 'system',
      action: key,
      params: req.params,
      body: req.body && typeof req.body === 'object' && Object.keys(req.body as object).length ? req.body : undefined,
    };
    const name = (b: unknown) => {
      const o = (b ?? {}) as Record<string, unknown>;
      return (o.name ?? o.title) as string | undefined;
    };
    return next.handle().pipe(
      tap((result) => {
        const res = ctx.switchToHttp().getResponse<Response>();
        const r = (result ?? {}) as Record<string, unknown>;
        const id = (req.params?.id as string | undefined) ?? (r._id ? String(r._id) : undefined);
        this.activity.log({
          actor: base.actor,
          category: base.category,
          action: base.action,
          summary: `${known?.summary ?? key}${name(r) ?? name(base.body) ? `: ${name(r) ?? name(base.body)}` : ''}`,
          target: id ? { type: base.category, id, name: name(r) ?? name(base.body) } : undefined,
          details: { params: base.params, body: base.body, status: res.statusCode, ms: Date.now() - started },
        });
      }),
      catchError((err: { status?: number; message?: string; response?: { message?: unknown } }) => {
        this.activity.log({
          actor: base.actor,
          level: 'warn',
          category: base.category,
          action: base.action,
          summary: `${known?.summary ?? key} thất bại: ${String(err.response?.message ?? err.message ?? err).slice(0, 300)}`,
          target: req.params?.id ? { type: base.category, id: req.params.id as string } : undefined,
          details: { params: base.params, body: base.body, status: err.status ?? 500, ms: Date.now() - started },
        });
        return throwError(() => err);
      }),
    );
  }
}
