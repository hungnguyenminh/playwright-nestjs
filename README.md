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
> Tham chiếu đầy đủ mọi action, tham số, điều kiện và hướng dẫn viết script: xem [docs/script.md](docs/script.md).

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

## Luồng và Dữ liệu

- **Luồng** (menu *Luồng*): mỗi việc mới gom profile (nếu cần đăng nhập) + script + inputs + cách chạy. Wizard *Tạo luồng mới* đi qua 5 bước: mục tiêu → profile (tạo mới và đăng nhập ngay trong trang) → script (có sẵn / tự viết / AI, có chạy thử) → job & task → xác nhận. Trang chi tiết luồng có nút *Chạy ngay*, *Chạy với input khác*, lịch sử các lần chạy, và link tới dữ liệu.
- **Dữ liệu** (menu *Dữ liệu*): kết quả của mọi task chạy xong được tự lưu vào collection `records`, theo luồng (hoặc script, nếu chạy ngoài luồng) và theo tên biến kết quả (ví dụ `posts`). Mảng object → mỗi phần tử 1 dòng; các giá trị đơn (title, price…) → 1 dòng mỗi task trong bộ "kết quả". Mục có cùng `url` / `link` / `href` / `id` được gộp qua các lần chạy (lưu thời điểm gặp lần đầu, lần cuối và số lần gặp). Dữ liệu vẫn còn khi xoá job. Có tìm kiếm, tải CSV (có BOM để Excel đọc đúng tiếng Việt) và JSON. Lần đầu khởi động sau khi có tính năng này, kết quả của các task đã chạy trước đó được nhập vào luôn.


## Trợ lý AI ("Tạo bằng AI")

Các trang **Script**, **Profile** (nút *✨ Tạo bằng AI*) và **New job** có khung *Tạo bằng AI*. Bạn mô tả yêu cầu bằng chữ; AI (Claude) viết một hướng dẫn hiện dần trên trang và đề xuất giá trị cho form. **Accept** chỉ điền vào form; việc lưu hay chạy vẫn do bạn bấm.

- **Cấu hình**: vào trang **Cài đặt → AI**, nhập Base URL (để trống là dùng `api.anthropic.com`; hoặc gateway tương thích Anthropic Messages API), loại token (API key hoặc Bearer), token, model (mặc định `claude-opus-5-5`) và effort. Có nút *Kiểm tra kết nối* và *Lấy danh sách model*. Token được mã hoá AES-256-GCM trong MongoDB bằng khoá `SETTINGS_SECRET` trong `backend/.env` (tự tạo ở lần chạy đầu; **đừng đổi khoá này**, nếu đổi thì phải nhập lại token). API không bao giờ trả lại token, chỉ trả 4 ký tự cuối. Nếu chưa lưu gì trên UI, backend dùng `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `AI_MODEL` trong `.env`.
- **Đọc trang trước khi viết** (Script, New job): backend mở trang bằng Chrome headless (có thể dùng profile đã đăng nhập), gửi cho AI cấu trúc rút gọn của trang (selector ổn định, danh sách lặp lại, thuộc tính đáng chú ý) cùng ảnh chụp màn hình, để selector khớp với trang thật thay vì phải đoán.
- **Nhờ AI sửa**: trên task bị lỗi, AI nhận bước lỗi, thông báo lỗi, log, script đang dùng và ảnh chụp lúc lỗi, rồi đề xuất bản sửa. Sau khi Accept, nút *Lưu & chạy lại task lỗi* lưu script và chạy lại các task lỗi của job bằng script mới (`POST /jobs/:id/retry { useLatestScript: true }`).
- Đề xuất được kiểm tra bằng đúng các luật mà app dùng khi lưu: schema action, biến, id script/profile có tồn tại. Nếu sai, lỗi được gửi lại cho AI để tự sửa (tối đa 3 lượt) trước khi hiện kết quả.

## API

```
GET/POST /scripts            GET/PUT/DELETE /scripts/:id
GET/POST /profiles           GET/PUT/DELETE /profiles/:id
POST /jobs                   { scriptId | actions, inputs[], vars?, concurrency?, headless?, profileId?, maxRetries?, stepTimeout? }
GET  /jobs?status=&page=&limit=          GET /jobs/:id    GET /jobs/:id/tasks
POST /jobs/:id/cancel        POST /jobs/:id/retry { useLatestScript? }        DELETE /jobs/:id
GET  /tasks/:id   /tasks/:id/logs   /tasks/:id/artifacts
POST /tasks/:id/cancel       POST /tasks/:id/pause         POST /tasks/:id/resume
GET  /artifacts/:id[?download=1]
GET  /actions/schema         POST /actions/validate        GET /system
GET/PUT /settings/ai         POST /settings/ai/test        POST /settings/ai/models
GET/POST /flows              GET/PUT/DELETE /flows/:id     POST /flows/:id/run { inputsText?, vars?, headless? }     GET /flows/:id/jobs
GET  /data/datasets          GET /data/records?scope=&dataset=&q=&page=&limit=
GET  /data/export?scope=&dataset=&format=csv|json            DELETE /data/records?scope=&dataset=    DELETE /data/records/:id
GET  /ai/status
POST /ai/assist              { kind: 'script'|'profile'|'job', prompt, history?, currentForm?, snapshotUrl?, snapshotProfileId?, fixTaskId? }
                             → server-sent events: status, snapshot, text, proposal, error, done
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
