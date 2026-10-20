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
`STORAGE_DIR` (ảnh chụp, PDF, file tải về), `PROFILES_DIR` (thư mục user-data của các profile; mặc định `%LOCALAPPDATA%\browser-automation\profiles`, ngoài thư mục dự án, profile cũ được tự chuyển sang).

## Khái niệm

> Giải thích chi tiết (script, biến, profile, job, task, trạng thái, nơi lưu dữ liệu, kèm ví dụ Facebook): xem [docs/khai-niem.md](docs/khai-niem.md).
> Tham chiếu đầy đủ mọi action, tham số, điều kiện và hướng dẫn viết script: xem [docs/script.md](docs/script.md).

- **Script**: danh sách action (DSL JSON), có `defaultVars` và `emulation`. Chuỗi trong action dùng biến dạng `{{name}}` / `{{obj.path}}`.
- **Job**: chạy một script với danh sách `inputs`, mỗi input là một **task** (một context Chrome riêng). Có `concurrency`, `headless`, `maxRetries`, `stepTimeout`, và `profileId` (tuỳ chọn).
- **Profile**: giữ cookie và đăng nhập giữa các job, ở một trong hai chế độ: **thư mục Chrome** (đầy đủ nhất, mỗi lúc một task) hoặc **trong database** (cookie + localStorage mã hoá AES, nhiều task chạy song song, phiên được lưu lại sau mỗi task). Trang Profiles có nút *Mở để đăng nhập* và *Phiên ▾ → Chuyển phiên từ thư mục vào DB*.

- **Takeover**: trên trang task, bấm *Pause* (script dừng trước bước kế tiếp) hoặc dùng action `pause`, rồi bật *Take control* để điều khiển chuột và bàn phím ngay trên live view, kể cả ở chế độ headless. Ctrl+V dán clipboard của máy bạn. Bấm *Resume* để script chạy tiếp.

Danh sách action đầy đủ có ở `backend/src/actions/action.schema.ts` (`GET /actions/schema`); trình soạn script trên UI có gợi ý và báo lỗi theo schema này. Các nhóm action:

- điều hướng: `goto` `back` `forward` `reload`
- tương tác: `click` `dblclick` `hover` `focus` `fill` `clear` `type` `press` `check` `uncheck` `select` `upload` `drag` `scroll` `mouse`
- chờ: `waitFor` `sleep` `pause` (chờ người bấm Resume trên UI, ví dụ để giải captcha)
- không cần selector: `dismissOverlays` `searchSite` `collect` `extractAuto`
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

## Menu

| Nhóm | Mục | Nội dung |
| --- | --- | --- |
| Vận hành | **Kéo dữ liệu** | tab *Luồng kéo dữ liệu* (luồng nguồn) · *Dữ liệu đã lấy* |
| | **Đăng bài** | tab *Tổng quan* · *Bài viết* · *Lịch đăng* |
| | **Kéo → Đăng** | luồng tự động: kéo định kỳ → AI viết bài từ dữ liệu mới → tự đăng theo lịch |
| Tài nguyên | Profiles · Scripts · **Luồng script** | luồng chạy script tự viết |
| Hệ thống | **Lịch sử chạy** (Jobs, kèm *New job*) · Cài đặt · Hướng dẫn | |

**Lịch sử chạy** gắn loại cho mỗi job (📥 Kéo dữ liệu · 🔁 Kéo → Đăng · 📤 Đăng bài · 🧩 Luồng script · 🔑 Đăng nhập · ✋ Chạy tay) và lọc được theo nhiều loại cùng lúc (`GET /jobs?category=crawl,publish`). Job đăng bài không chạy lại được (tạo lượt mới từ bài viết / lịch đăng).

## Luồng và Dữ liệu

- **Luồng script** (menu *Luồng script*): gom profile (nếu cần đăng nhập) + script + inputs + cách chạy. Wizard: mục tiêu → profile (tạo mới và đăng nhập ngay trong trang) → script (có sẵn / tự viết / AI, có chạy thử) → job & task → xác nhận.
- **Tự chạy định kỳ** (mọi loại luồng, bước *Cách chạy*): mỗi N giờ / ngày, có thể giới hạn khung giờ. Máy tắt lúc tới giờ thì khi bật lại chạy bù một lần rồi tiếp tục chu kỳ; lần trước chưa xong thì bỏ qua lượt đó. Trang chi tiết luồng có công tắc bật / tắt và lịch sử từng lần kéo (`flow_runs`: số job, số dòng mới).
- **Luồng kéo dữ liệu từ nguồn** (menu *Kéo dữ liệu*): thêm các nguồn Website khác (link, từ khoá tuỳ chọn: có từ khoá thì gõ vào ô tìm kiếm của trang), Facebook group (link), Google / YouTube / TikTok / Threads / Shopee (từ khoá). Mặc định 50 mục mỗi link / từ khoá, chế độ lấy chi tiết tắt. Mỗi lần chạy tạo một job cho mỗi nguồn (chung `runId`); dữ liệu mỗi nguồn một bảng. Chi tiết: [docs/khai-niem.md mục 9](docs/khai-niem.md).
- **Dữ liệu** (menu *Dữ liệu*): kết quả của mọi task chạy xong được tự lưu vào collection `records`, theo luồng (hoặc script, nếu chạy ngoài luồng) và theo tên biến kết quả (ví dụ `posts`). Mảng object → mỗi phần tử 1 dòng; các giá trị đơn (title, price…) → 1 dòng mỗi task trong bộ "kết quả". Mục có cùng `url` / `link` / `href` / `id` được gộp qua các lần chạy (lưu thời điểm gặp lần đầu, lần cuối và số lần gặp). Dữ liệu vẫn còn khi xoá job. Có tìm kiếm, tải CSV (có BOM để Excel đọc đúng tiếng Việt) và JSON. Lần đầu khởi động sau khi có tính năng này, kết quả của các task đã chạy trước đó được nhập vào luôn.


## Nhật ký hoạt động

Menu **Hệ thống → Nhật ký hoạt động** (collection `activity_logs`, giữ `ACTIVITY_TTL_DAYS` ngày, mặc định 180):

- **Người dùng**: mọi thao tác thay đổi qua giao diện / API (tạo, sửa, xoá, chạy, đăng, duyệt…), kèm đối tượng, nội dung gửi lên (token, mật khẩu, cookie, phiên được che `***`), mã kết quả và thời gian xử lý; thao tác thất bại cũng được ghi.
- **Hệ thống**: job xong / lỗi, task lỗi (bước, lý do), lượt đăng đã đăng / chờ duyệt / lỗi, lịch đăng dời lịch / hoàn tất, luồng tự chạy, kết quả mỗi lần kéo (dòng mới, bài AI viết), profile bị đánh dấu cần đăng nhập lại, máy chủ khởi động.
- **AI**: mỗi lần AI sửa bộ đăng (trước → sau, lý do, model) và mỗi lần thử chưa đạt.
- Lọc theo ai làm, mục, mức (cảnh báo / lỗi), thời gian, tìm theo chữ; mở rộng từng dòng để xem chi tiết. API: `GET /activity?actor=&category=&level=&q=&from=&to=`.

## Bộ đăng và AI tự sửa

Tab **Đăng bài → Bộ đăng** liệt kê các bộ chọn (selector) mà bộ đăng Facebook / Threads dùng (nút mở khung soạn, ô nhập, ô file, nút Đăng, nút đóng, nút chọn đối tượng…), mỗi cái có giá trị đang dùng, mặc định và lịch sử phiên bản (`selector_versions`).

- Khi một lượt đăng (hoặc Đăng thử) lỗi **trước khi bấm Đăng** vì không tìm thấy phần tử, AI tự: mở lại trang bằng đúng profile (chỉ xem, có thể mở khung soạn), đọc cấu trúc trang + ảnh chụp, đề xuất bộ chọn mới (ưu tiên **mở rộng** bộ chọn cũ để trang khác vẫn chạy), **kiểm tra trên trang thật** (chỉ tìm, không bấm Đăng), lưu phiên bản mới kèm lý do / lỗi gốc / model / task, ghi nhật ký, rồi **đăng lại** lượt lỗi. Tối đa 3 lần sửa mỗi bộ chọn mỗi ngày, cách nhau ít nhất 10 phút.
- Có nút **Sửa** (sửa tay), **Khôi phục** (về mặc định), **✨ Nhờ AI sửa** (chọn profile và trang).

```
GET  /publish/selectors     GET /publish/selectors/:key/history
PUT  /publish/selectors/:key { value, reason? }   POST /publish/selectors/:key/revert   POST /publish/selectors/:key/ai-fix { profileId, kind, url? }
```

## Kéo → Đăng (luồng tự động)

Menu **Kéo → Đăng** → *+ Luồng Kéo → Đăng*, wizard 7 bước: mục tiêu → nguồn → lịch kéo (mặc định mỗi 6 giờ) → **viết bài bằng AI** → nơi đăng & tài khoản → lịch đăng (định kỳ, không giới hạn) → xác nhận.

- Mỗi lần kéo xong (mọi job của lần chạy kết thúc), các **dòng mới** của luồng (lọc theo từ khoá / chỉ dòng có ảnh nếu muốn, tối đa *N bài mỗi lần kéo*) được gửi cho AI. AI viết **mỗi dòng một bài** hoặc **gộp nhiều dòng thành bài tổng hợp**, theo yêu cầu của bạn, chỉ dùng thông tin có trong dữ liệu, văn bản thuần (không markdown). Bài được kiểm tra theo giới hạn từng nền tảng; sai thì AI tự sửa (tối đa 3 lượt). Bài gắn link nguồn, ảnh của dòng (nếu bật), nhãn tên luồng, và ghi lại dòng dữ liệu gốc nên **một dòng không bao giờ có hai bài**.
- **Duyệt**: *Chờ tôi duyệt* (bài vào Nháp, duyệt nhanh ngay trên trang luồng) hoặc *Tự duyệt* (Sẵn sàng, tự đăng).
- **Đăng**: luồng có một lịch đăng riêng (hiện cả ở tab *Lịch đăng*), mỗi lượt lấy bài Sẵn sàng **cũ nhất** của luồng chưa đăng ở nơi đó; hết bài thì lượt chờ, có bài mới thì đăng và dời các lượt sau. Mọi luật chống spam / xoay vòng của Lịch đăng vẫn áp dụng.
- Trang chi tiết: *Chạy ngay (kéo + viết bài)*, bật / tắt tự kéo, *Tạm dừng / Tiếp tục đăng*, bảng các lần kéo (dòng mới, bài đã viết, lỗi), bài chờ duyệt, lượt sắp đăng / đã đăng.
- Trang **Dữ liệu** cũng có *✨ Tạo bài bằng AI* cho các dòng bạn chọn.
- Cần cấu hình AI ở *Cài đặt → AI*.

```
GET  /flows?kind=sources,pipeline     POST /flows { kind: 'pipeline', sources, autoRun, generate, campaign }
POST /flows/:id/auto-run { enabled }  GET /flows/:id/runs
POST /posts/generate { recordIds[], platforms[], mode, digestSize?, prompt?, tone?, length?, attachImage?, approval?, tags? }
```

## Đăng bài (đang làm: xong giai đoạn 1 và 4 của plan)

> Các bộ đăng thật (Facebook, Threads, TikTok, YouTube trong `backend/src/publish/publishers.ts`) **chưa được kiểm chứng trên tài khoản thật**. Hãy dùng *Đăng thử* (dừng ngay trước nút Đăng, xem trên live view) trước khi bật lịch đăng thật. Bộ lập lịch, xoay vòng tài khoản, chống spam và dời lịch đã được kiểm thử bằng trang đăng giả trên máy (`backend/test/publish.e2e-spec.ts`).

**Lịch đăng** (tab *Lịch đăng*, wizard 4 bước: nơi đăng & tài khoản → bài viết → lịch → xác nhận):

- **Điểm đăng**: trang cá nhân / kênh của tài khoản, hoặc Page / Group Facebook (link được kiểm tra: link bài viết, sự kiện, watch, marketplace… bị từ chối). Mỗi điểm đăng có một nhóm profile, chọn **Xoay vòng** (mỗi lượt 1 tài khoản, lần lượt / ngẫu nhiên / ai lâu chưa đăng nhất) hoặc **Tất cả cùng đăng** (giãn cách giữa các tài khoản, cùng bài / mỗi người một bài / danh sách riêng).
- **Chống spam** (sửa được): 1 profile ở cùng điểm đăng cách nhau 4 giờ, tối đa 2 bài/ngày, không lặp 1 bài trong 30 ngày, 1 profile cách nhau 60′ trên mọi nơi; wizard cảnh báo khi lịch dễ bị coi là spam.
- **Lịch**: 1 lần, chọn ngày giờ, hoặc định kỳ (mặc định mỗi 1 giờ, lệch ngẫu nhiên ±10′, khung giờ 7h–23h, có thể không giới hạn số lần).
- **Tài khoản và bài được chốt lúc tới lượt**: profile cần đăng nhập lại / đang bận / chưa hết khoảng nghỉ thì chuyển người kế tiếp; lỗi **trước** khi bấm Đăng thì thử tài khoản khác, lỗi **sau** khi bấm Đăng thì lượt thành *Không rõ* (không tự đăng lại; bạn chọn *Đã đăng* hoặc *Đăng lại*). Profile bị đòi đăng nhập được đánh dấu "cần đăng nhập lại" (trang Profiles, bấm để bỏ đánh dấu sau khi đăng nhập).
- **Máy tắt lúc tới giờ**: lượt trễ đầu tiên đăng ngay, các lượt sau dời theo đúng khoảng cách cũ (hoặc chọn *Bỏ qua lượt trễ*). Tạm dừng rồi tiếp tục cũng dời như vậy.
- Nhóm duyệt bài → *Chờ admin duyệt* (không tính là lỗi). **Đăng ngay** (tab Tổng quan) = lịch 1 lần.

```
GET/POST /campaigns   POST /campaigns/preview   GET/PUT/DELETE /campaigns/:id   POST /campaigns/:id/activate|pause|resume|cancel
GET  /campaigns/:id/publications ?status=&destIndex=&profileId=   GET /campaigns/:id/stats
PUT  /publications/:id { scheduledAt?, postId? }   POST /publications/:id/skip|retry|mark-published
GET  /publish/upcoming ?from=&to=&platform=&profileId=   POST /publish/parse-destination { url }
POST /publish/now { postId, targets[] }   POST /publish/test { postId, target }   POST /profiles/:id/health/clear
POST /publish/check-destination { url, profileIds[] }   (mở Page / Group bằng từng profile, chỉ xem: thành viên? đăng được?)
```

Socket.IO `/live` thêm sự kiện `publication:update` (phòng `subscribe:jobs`).

**Bài viết**: menu **Đăng bài** → tab **Bài viết**, kho bài dùng chung cho đăng ngay và lịch đăng.

- Mỗi bài có nội dung chung, hashtag, link, ảnh / video (tải lên, dán link ảnh, hoặc chọn từ thư viện; file nằm ở `STORAGE_DIR/media`, giới hạn `MEDIA_MAX_MB`), và chọn đăng lên **Facebook, YouTube, TikTok, Threads**.
- Mỗi nền tảng có tab riêng: **dạng bài** (mặc định tự đoán theo media: không media → chữ, 1 ảnh → ảnh, nhiều ảnh → album, video dọc ngắn → Reels / Shorts…), nội dung ghi đè, tuỳ chọn riêng (quyền xem, bình luận đầu tiên, tiêu đề / tags / thumbnail YouTube, ảnh bìa và Duet/Stitch TikTok, chuỗi thread…), xem trước chữ sẽ đăng, đếm ký tự và báo lỗi theo giới hạn của nền tảng.
- Trạng thái: **Nháp** → **Sẵn sàng** (chỉ khi không còn lỗi) → **Lưu trữ**. Duyệt hàng loạt ở danh sách bài.

```
GET/POST /posts ?status=&tag=&flowId=&q=   GET/PUT/DELETE /posts/:id   POST /posts/:id/duplicate   GET /posts/tags
POST /posts/check { post, platforms? }     POST /posts/bulk-status { ids[], status }
GET/POST /media (multipart, field file)    POST /media/from-url { url }   GET /media/:id   GET /media/:id/file   DELETE /media/:id
GET  /publish/platforms
```

## Trợ lý AI ("Tạo bằng AI")

Các trang **Script**, **Profile** (nút *✨ Tạo bằng AI*) và **New job** có khung *Tạo bằng AI*. Bạn mô tả yêu cầu bằng chữ; AI (Claude) viết một hướng dẫn hiện dần trên trang và đề xuất giá trị cho form. **Accept** chỉ điền vào form; việc lưu hay chạy vẫn do bạn bấm.

- **Cấu hình**: vào trang **Cài đặt → AI**, nhập Base URL (để trống là dùng `api.anthropic.com`; hoặc gateway tương thích Anthropic Messages API), loại token (API key hoặc Bearer), token, model (mặc định `claude-opus-5-5`) và effort. Có nút *Kiểm tra kết nối* và *Lấy danh sách model*. Token được mã hoá AES-256-GCM trong MongoDB bằng khoá `SETTINGS_SECRET` trong `backend/.env` (tự tạo ở lần chạy đầu; **đừng đổi khoá này**, nếu đổi thì phải nhập lại token). API không bao giờ trả lại token, chỉ trả 4 ký tự cuối. Nếu chưa lưu gì trên UI, backend dùng `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` / `AI_MODEL` trong `.env`.
- **Đọc trang trước khi viết** (Script, New job): backend mở trang bằng Chrome headless (có thể dùng profile đã đăng nhập), gửi cho AI cấu trúc rút gọn của trang (selector ổn định, danh sách lặp lại, thuộc tính đáng chú ý) cùng ảnh chụp màn hình, để selector khớp với trang thật thay vì phải đoán.
- **Nhờ AI sửa**: trên task bị lỗi, AI nhận bước lỗi, thông báo lỗi, log, script đang dùng và ảnh chụp lúc lỗi, rồi đề xuất bản sửa. Sau khi Accept, nút *Lưu & chạy lại task lỗi* lưu script và chạy lại các task lỗi của job bằng script mới (`POST /jobs/:id/retry { useLatestScript: true }`).
- Đề xuất được kiểm tra bằng đúng các luật mà app dùng khi lưu: schema action, biến, id script/profile có tồn tại. Nếu sai, lỗi được gửi lại cho AI để tự sửa (tối đa 3 lượt) trước khi hiện kết quả.

## API

```
GET/POST /scripts            GET/PUT/DELETE /scripts/:id
GET/POST /profiles           GET/PUT/DELETE /profiles/:id   POST /profiles/:id/import-session   DELETE /profiles/:id/session
POST /jobs                   { scriptId | actions, inputs[], vars?, concurrency?, headless?, profileId?, maxRetries?, stepTimeout? }
GET  /jobs?status=&page=&limit=          GET /jobs/:id    GET /jobs/:id/tasks
POST /jobs/:id/cancel        POST /jobs/:id/retry { useLatestScript? }        DELETE /jobs/:id
GET  /tasks/:id   /tasks/:id/logs   /tasks/:id/artifacts
POST /tasks/:id/cancel       POST /tasks/:id/pause         POST /tasks/:id/resume
GET  /artifacts/:id[?download=1]
GET  /actions/schema         POST /actions/validate        GET /system
GET/PUT /settings/ai         POST /settings/ai/test        POST /settings/ai/models
GET/POST /flows              { kind: 'script'|'sources', scriptId? | sources[]: { type, targets[], keywords?, limit?, detail?, profileId? } … }
GET/PUT/DELETE /flows/:id    POST /flows/:id/run { inputsText?, vars?, headless? } (nguồn → { runId, jobs })     GET /flows/:id/jobs
GET  /sources                POST /sources/preview { source }      POST /sources/test { source, headless? }
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
