# playwright-nestjs

Tool tự động hoá trình duyệt chạy trên PC: soạn script bằng DSL JSON, chạy nhiều Google Chrome song song, xem live từng tab ngay trên web.

| App        | Path        | Stack                                                    | Port |
| ---------- | ----------- | -------------------------------------------------------- | ---- |
| `backend`  | `backend/`  | NestJS 12 (ESM, Rspack), Playwright, MongoDB, Socket.IO  | 3001 |
| `frontend` | `frontend/` | Nuxt 3 (SPA), Element Plus, Tailwind, Pinia, Monaco      | 3000 |

## Yêu cầu

- Node 20 trở lên
- Đã cài Google Chrome (Playwright chạy với `channel: 'chrome'`, không cần `playwright install`)
- MongoDB Community chạy local: `mongodb://localhost:27017/browser-automation`

## Chạy

```bash
npm install
cp backend/.env.example backend/.env       # nếu chưa có
cp frontend/.env.example frontend/.env
npm run dev                                # BE :3001 + FE :3000
```

Mở http://localhost:3000.

Biến môi trường của backend (`backend/.env`): `PORT`, `MONGODB_URI`, `FRONTEND_ORIGIN`, `HEADLESS`,
`MAX_CONCURRENCY` (tổng số context Chrome cùng lúc), `CONTEXTS_PER_BROWSER` (số context trên mỗi tiến trình Chrome),
`STORAGE_DIR` (ảnh chụp, PDF, file tải về), `PROFILES_DIR` (thư mục user-data của các profile).

## Khái niệm

> Giải thích chi tiết (script, biến, profile, job, task, trạng thái, nơi lưu dữ liệu, kèm ví dụ Facebook): xem [docs/khai-niem.md](docs/khai-niem.md).

- **Script**: danh sách action (DSL JSON), có `defaultVars` và `emulation`. Chuỗi trong action dùng biến dạng `{{name}}` / `{{obj.path}}`.
- **Job**: chạy một script với danh sách `inputs`, mỗi input là một **task** (một context Chrome riêng). Có `concurrency`, `headless`, `maxRetries`, `stepTimeout`, và `profileId` (tuỳ chọn).
- **Profile**: thư mục user-data Chrome riêng, giữ cookie và đăng nhập giữa các job. Mỗi lúc chỉ một task được dùng một profile. Trang Profiles có nút *Open to log in* để mở Chrome và đăng nhập bằng tay.

- **Takeover**: trên trang task, bấm *Pause* (script dừng trước bước kế tiếp) hoặc dùng action `pause`, rồi bật *Take control* để điều khiển chuột và bàn phím ngay trên live view, kể cả ở chế độ headless. Ctrl+V dán clipboard của máy bạn. Bấm *Resume* để script chạy tiếp.

Danh sách action đầy đủ có ở `backend/src/actions/action.schema.ts` (`GET /actions/schema`); trình soạn script trên UI có gợi ý và báo lỗi theo schema này. Các nhóm action:

- điều hướng: `goto` `back` `forward` `reload`
- tương tác: `click` `dblclick` `hover` `focus` `fill` `clear` `type` `press` `check` `uncheck` `select` `upload` `drag` `scroll` `mouse`
- chờ: `waitFor` `sleep` `pause` (chờ người bấm Resume trên UI, ví dụ để giải captcha)
- dữ liệu: `extract` `screenshot` `pdf` `download` `getCookies` `setCookies` `clearCookies` `evaluate` `set` `log`
- mạng: `blockResources` `intercept` `captureResponses`
- tab và iframe: `newTab` `switchTab` `closeTab` `frame` `dialog`
- điều khiển luồng: `if` `repeat` `forEach` `try` `break` `stop`

Mọi action đều nhận `timeout`, `optional: true` (lỗi thì bỏ qua) và `label`.

```json
[
  { "type": "goto", "url": "https://example.com/search?q={{keyword}}" },
  { "type": "extract", "selector": ".item", "multiple": true,
    "fields": { "title": "h2", "link": { "selector": "a", "get": "prop:href" } }, "as": "items" },
  { "type": "if", "condition": { "exists": ".next" }, "then": [{ "type": "click", "selector": ".next" }] }
]
```

## API

```
GET/POST /scripts            GET/PUT/DELETE /scripts/:id
GET/POST /profiles           GET/PUT/DELETE /profiles/:id
POST /jobs                   { scriptId | actions, inputs[], vars?, concurrency?, headless?, profileId?, maxRetries?, stepTimeout? }
GET  /jobs?status=&page=&limit=          GET /jobs/:id    GET /jobs/:id/tasks
POST /jobs/:id/cancel        POST /jobs/:id/retry          DELETE /jobs/:id
GET  /tasks/:id   /tasks/:id/logs   /tasks/:id/artifacts
POST /tasks/:id/cancel       POST /tasks/:id/pause         POST /tasks/:id/resume
GET  /artifacts/:id[?download=1]
GET  /actions/schema         POST /actions/validate        GET /system
```

Socket.IO, namespace `/live`:

- client gửi lên: `subscribe:jobs`, `subscribe:job {jobId}`, `subscribe:task {taskId, quality: 'low'|'high', frames?}`, `unsubscribe`,
  `input {taskId, kind: 'mouse'|'wheel'|'key'|'text', ...}` (ack `{ok, error?}`, chỉ nhận khi task đang paused)
- server gửi xuống: `job:update`, `task:update`, `task:log`, `task:frame` (JPEG base64, lấy từ CDP screencast; chỉ stream khi có người đang xem)

## Test

```bash
npm test -w backend                # unit, chạy với Chrome thật
npm run test:e2e -w backend        # API + Mongo (DB browser-automation-test) + Chrome
npm run lint -w backend
npm run typecheck -w frontend
```
