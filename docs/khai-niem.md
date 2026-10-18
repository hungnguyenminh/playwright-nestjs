# Các khái niệm

Tài liệu này giải thích các khái niệm chính của tool: **Script**, **Profile**, **Job**, **Task**, cùng cách chúng phối hợp khi chạy. **Luồng** gom cả bốn thứ đó thành một việc lưu sẵn để chạy lại (xem mục 8), và **Dữ liệu** là nơi lưu kết quả. Phần cài đặt và chạy xem ở [README](../README.md).

```
 Script ──────────┐   "làm gì trên trang"
 (actions, biến)  │
                  ▼
 Profile ───────► Job ─────────► Task #1 ─► kết quả, log, ảnh chụp
 (đăng nhập,      "chạy thế nào"  Task #2 ─► kết quả, log, ảnh chụp
  cookie, proxy)  (song song,     Task #3 ─► ...
                   headed, ...)   (mỗi dòng input là 1 task)
```

| Khái niệm | Trả lời câu hỏi | Lưu ở đâu |
| --- | --- | --- |
| **Script** | Làm gì trên trang? | MongoDB, collection `scripts` |
| **Profile** | Chạy bằng "người dùng Chrome" nào (đăng nhập, cookie, proxy)? | collection `profiles` + thư mục profile (mặc định `%LOCALAPPDATA%\browser-automation\profiles\<id>\`) |
| **Job** | Chạy lúc nào, bao nhiêu Chrome song song, chế độ nào? | collection `jobs` |
| **Task** | Chạy với đầu vào cụ thể nào, ra kết quả gì? | collection `tasks` (kết quả trong `result`) |

---

## 1. Script

Script là **"công thức" đã lưu sẵn để chạy lại nhiều lần**: nó mô tả **làm gì** trên trang web. Mỗi script gồm:

| Phần | Nội dung | Ví dụ |
| --- | --- | --- |
| `actions` | Danh sách bước thao tác, chạy theo thứ tự | mở trang → chờ → cuộn → lấy dữ liệu |
| `defaultVars` | Giá trị mặc định cho các biến `{{...}}` | `{ "url": "https://...", "scrolls": 10 }` |
| `emulation` | Môi trường trình duyệt | `{ "locale": "vi-VN", "timezoneId": "Asia/Ho_Chi_Minh" }` |

Script **không** lưu các thiết lập lúc chạy (bao nhiêu Chrome song song, headless/headed, profile nào). Những thứ đó chọn khi tạo **Job**.

### Action

Mỗi action là một object JSON có `type`, ví dụ:

```json
[
  { "type": "goto", "url": "{{url}}" },
  { "type": "fill", "selector": "#q", "value": "{{keyword}}" },
  { "type": "press", "key": "Enter" },
  { "type": "extract", "selector": ".item", "multiple": true,
    "fields": { "title": "h2", "link": { "selector": "a", "get": "prop:href" } }, "as": "items" }
]
```

Các nhóm action:

| Nhóm | Action |
| --- | --- |
| Điều hướng | `goto` `back` `forward` `reload` |
| Tương tác | `click` `dblclick` `hover` `focus` `fill` `clear` `type` `press` `check` `uncheck` `select` `upload` `drag` `scroll` `mouse` |
| Chờ | `waitFor` `sleep` `pause` |
| Dữ liệu | `extract` `screenshot` `pdf` `download` `getCookies` `setCookies` `clearCookies` `evaluate` `set` `log` |
| Mạng | `blockResources` `intercept` `captureResponses` |
| Tab, iframe | `newTab` `switchTab` `closeTab` `frame` `dialog` |
| Điều khiển luồng | `if` `repeat` `forEach` `try` `break` `stop` |

Mọi action đều nhận thêm:

- `timeout`: thời gian chờ tối đa (ms)
- `optional: true`: lỗi thì bỏ qua và chạy tiếp
- `label`: tên hiển thị trong log

Trong trình soạn script trên UI, bấm **Ctrl+Space** để xem gợi ý mọi action và tham số; script sai cú pháp sẽ bị gạch đỏ.

Danh sách đầy đủ mọi action, tham số, điều kiện và hướng dẫn viết script từng bước: xem [script.md](script.md).

### Biến `{{...}}`

Chuỗi nào trong action cũng có thể chứa biến, ví dụ `"url": "{{url}}"` hoặc `"{{user.name}}"`. Biến có thể đến từ:

1. `defaultVars` của script
2. **Shared variables** khi tạo job
3. **Dòng Inputs** của từng task

Nếu trùng tên, nguồn sau đè nguồn trước: **Inputs > Shared variables > defaultVars**.

Các action như `extract`, `evaluate` và `set` (thuộc tính `as` / `var`) tạo thêm biến trong lúc chạy, để các bước sau dùng tiếp.

### Kết quả

Biến nào được tạo bằng `extract`, `evaluate` (có `as`), `getCookies`, `download` hoặc `captureResponses` thì cũng được lưu vào **kết quả của task** (`result`).

---

## 2. Profile

Profile giữ **phiên đăng nhập** giữa các lần chạy, giống một "người dùng Chrome". Có hai chế độ lưu phiên:

| | Không dùng profile | Profile · **Thư mục Chrome** (mặc định) | Profile · **Trong database** |
| --- | --- | --- | --- |
| Lưu ở đâu | Không lưu | Thư mục dữ liệu Chrome: `%LOCALAPPDATA%\browser-automation\profiles\<id>\` (đổi bằng `PROFILES_DIR`) | MongoDB `profiles`, cookie + localStorage **mã hoá AES** bằng `SETTINGS_SECRET` |
| Lưu những gì | | Mọi thứ Chrome giữ: cookie, localStorage, IndexedDB, cache, lịch sử… | Cookie và localStorage |
| Song song | Nhiều task cùng lúc | Mỗi lúc **chỉ một task** (Chrome khoá thư mục) | **Nhiều task cùng lúc**, dùng chung phiên |
| Sau mỗi task | | Chrome tự ghi vào thư mục | Phiên mới (cookie được làm mới) được lưu lại |
| Phù hợp cho | Trang công khai | Trang cần đăng nhập, giữ phiên ổn định nhất (Facebook…) | Trang cần đăng nhập mà muốn chạy song song |

Nơi lưu phiên không quyết định việc trang web có nghi ngờ hay không (cookie là như nhau). Điều cần cân nhắc: chế độ database không giữ IndexedDB, nên vài trang có thể hỏi đăng nhập lại; và dùng **một tài khoản ở nhiều Chrome cùng lúc** là điều một số trang theo dõi.

Chuyển một profile thư mục sang database: trang **Profiles → Phiên ▾ → Chuyển phiên từ thư mục vào DB** (thư mục vẫn được giữ).

Mỗi profile có thể có thêm:

- **Proxy** riêng (`http://host:port` hoặc `socks5://...`)
- **Emulation** riêng: ngôn ngữ, múi giờ, kích thước màn hình, user-agent

### Đăng nhập lần đầu

1. Vào **Profiles**, bấm **New profile**, rồi **Save**.
2. Bấm **Open to log in** và nhập trang cần đăng nhập. Một cửa sổ Chrome thật mở ra.
3. Đăng nhập bằng tay trong cửa sổ đó (kể cả 2FA, captcha).
4. Quay lại tool, bấm **Resume**. Chrome đóng lại và phiên đăng nhập được lưu vào profile.

Khi tạo job, chọn profile đó là script chạy ở trạng thái đã đăng nhập.

> Profile đang được một task dùng thì hiện **in use** và không chọn được cho job khác, cho đến khi task đó xong (hoặc được Resume / Cancel).
> Không trỏ profile vào thư mục Chrome bạn đang dùng hằng ngày. Nên dùng tài khoản phụ cho các trang có thể khoá tài khoản khi chạy tự động.

---

## 3. Job

Job là **một lần bấm Start**: chạy **một script** cho **một danh sách đầu vào**, kèm các thiết lập chạy:

| Thiết lập | Ý nghĩa |
| --- | --- |
| Script / Inline actions | Chạy script đã lưu, hoặc dán thẳng danh sách action |
| Inputs | Mỗi dòng (CSV/JSON) tạo ra **một task**. Để trống thì job có 1 task |
| Shared variables | Biến dùng chung cho mọi task của job |
| Concurrency | Số task (Chrome context) chạy song song trong job |
| Headless / headed | Ẩn hoặc hiện cửa sổ Chrome |
| Profile | Dùng profile đã đăng nhập (khi đó các task chạy lần lượt từng cái) |
| Retries | Số lần tự chạy lại một task bị lỗi |
| Step timeout | Thời gian chờ mặc định cho mỗi bước |

Job lưu **bản sao** các action tại thời điểm tạo, nên sửa script sau đó không ảnh hưởng tới job đang hoặc đã chạy.

### Trạng thái job

| Trạng thái | Ý nghĩa |
| --- | --- |
| `queued` | Vừa tạo, chưa chạy |
| `running` | Còn task chưa xong (kể cả task đang **paused** chờ bạn) |
| `done` | Mọi task thành công |
| `failed` | Có ít nhất một task lỗi; bấm **Retry failed** để chạy lại riêng các task lỗi |
| `cancelled` | Đã bị huỷ |

Ngoài ra còn giới hạn chung toàn hệ thống: `MAX_CONCURRENCY` trong `backend/.env` là tổng số Chrome chạy cùng lúc của mọi job cộng lại.

---

## 4. Task

Task là **một lần chạy script cho một đầu vào** (một dòng Inputs). Mỗi task có Chrome riêng, biến riêng, log riêng và kết quả riêng.

```
Inputs:
  name,url
  Cầu lông HN,https://facebook.com/groups/A   →  Task #1
  Pickleball,https://facebook.com/groups/B    →  Task #2
```

Trên trang task bạn xem được:

- **Live view**: màn hình Chrome của task, cập nhật theo thời gian thực
- **Steps**: log từng bước (thành công, lỗi, bỏ qua, thời gian chạy)
- **Result**: dữ liệu lấy được
- **Variables**: biến đầu vào của task
- **Artifacts**: ảnh chụp, PDF, file tải về

### Trạng thái task

| Trạng thái | Ý nghĩa |
| --- | --- |
| `queued` | Đang chờ tới lượt (giới hạn concurrency, hoặc chờ profile rảnh) |
| `running` | Đang chạy |
| `paused` | Đang dừng chờ bạn: gặp action `pause`, hoặc bạn bấm **Pause**. Bấm **Resume** để chạy tiếp |
| `done` | Chạy xong |
| `failed` | Lỗi. Xem bước lỗi (`stepPath`), thông báo lỗi và ảnh chụp màn hình lúc lỗi |
| `cancelled` | Bị huỷ |

### Pause và điều khiển tay (takeover)

Khi gặp captcha, OTP hay bước cần người làm:

1. Task dừng lại, nhờ action `pause` trong script hoặc do bạn bấm **Pause** (task dừng trước bước kế tiếp).
2. Bật **Take control** để click và gõ phím trực tiếp trên live view, kể cả ở chế độ headless. Ctrl+V dán clipboard từ máy bạn. Ở chế độ headed thì thao tác thẳng trên cửa sổ Chrome cũng được.
3. Bấm **Resume** để script chạy tiếp.

---

## 5. Dữ liệu được lưu ở đâu

| Dữ liệu | Nơi lưu |
| --- | --- |
| Script | MongoDB `scripts` |
| Profile | MongoDB `profiles` (phiên mã hoá nếu ở chế độ database) + thư mục `%LOCALAPPDATA%\browser-automation\profiles\<id>\` |
| Job | MongoDB `jobs` |
| Task và **kết quả** (`result`) | MongoDB `tasks` |
| Log từng bước | MongoDB `task_logs` (tự xoá sau 30 ngày) |
| Ảnh chụp, PDF, file tải về | `backend/storage/<jobId>/<taskId>/` + MongoDB `artifacts` |

- Xem kết quả: trang task (khung **Result**), hoặc nút **Export results** trên trang job để tải file JSON.
- Xoá một job sẽ xoá luôn các task, log và file trong `storage/` của job đó. Script và profile không bị ảnh hưởng.

---

## 6. Ví dụ đầy đủ: lấy bài đăng trong nhóm Facebook

1. **Profile**: tạo profile `facebook`, bấm **Open to log in**, đăng nhập rồi **Resume**.
2. **Script** "Facebook group – lấy bài đăng" (đã có sẵn trong mục Scripts):
   - `defaultVars`: `url` (link nhóm, sắp theo bài mới nhất), `scrolls: 10`
   - `actions`: mở nhóm → chờ feed → lặp `scrolls` lần (mở "Xem thêm", gom bài, cuộn, nghỉ ngẫu nhiên) → trả về `posts`
3. **Job**: vào **New job**, chọn script, để trống Inputs (hoặc dán nhiều nhóm `name,url,scrolls`), Profile = `facebook`, chọn **headed**, bấm **Start**.
4. **Task**: theo dõi live và log `lần N: đã gom X bài`; xong thì xem **Result → `posts`**:

```json
{
  "author": "Dieu Linh",
  "time": "6 phút",
  "text": "TUYỂN GIAO LƯU CHIỀU …",
  "url": "https://www.facebook.com/groups/…/posts/1576335590484958/",
  "images": ["https://scontent…"]
}
```

---

## 7. Trợ lý AI ("Tạo bằng AI")

Các trang **Script**, **Profiles** và **New job** có khung **Tạo bằng AI**: bạn mô tả yêu cầu bằng chữ, AI viết hướng dẫn ngay trong trang và đề xuất giá trị cho form.

| Bước | Việc |
| --- | --- |
| Cấu hình (một lần) | **Cài đặt → AI**: Base URL (để trống = `api.anthropic.com`, hoặc gateway tương thích Anthropic Messages API), loại token (API key / Bearer), token, model, effort. Token được mã hoá AES-256-GCM bằng `SETTINGS_SECRET` trong `backend/.env` và không bao giờ được trả lại đầy đủ |
| Yêu cầu | Gõ mô tả. Ở trang Script / New job có thể tick **Đọc trang trước khi viết**: backend mở trang (có thể kèm profile đã đăng nhập) và gửi cho AI cấu trúc rút gọn cùng ảnh chụp, để AI chọn selector có thật trên trang |
| Đề xuất | AI trả hướng dẫn (hiện dần) và một đề xuất form. Backend kiểm tra đề xuất bằng đúng luật dùng khi lưu (schema action, biến, id script/profile); nếu sai thì gửi lỗi lại cho AI tự sửa, tối đa 3 lượt |
| Accept | **Chỉ điền vào form**. Bạn vẫn tự Save / Start |
| Chỉnh tiếp | Gõ yêu cầu chỉnh; AI sửa trên đề xuất trước |
| Sửa task lỗi | Trang task lỗi → **✨ Nhờ AI sửa**: AI nhận bước lỗi, thông báo lỗi, log, script và ảnh chụp lúc lỗi → đề xuất bản sửa → **Lưu & chạy lại task lỗi** (job chạy lại các task lỗi bằng script mới nhất) |

---

## 8. Luồng và Dữ liệu

**Luồng** = một việc lưu sẵn: *profile (nếu cần) + script + inputs + cách chạy*. Tạo bằng wizard **Luồng → Tạo luồng mới** (mục tiêu → profile → script → job & task → xác nhận). Mỗi lần bấm **▶ Chạy** sinh ra một job (tên dạng "Tên luồng · lần N") và các task của nó; trang chi tiết luồng liệt kê mọi lần chạy.

```
Luồng "Theo dõi giá"
 ├─ Profile: shop-test (tuỳ chọn)
 ├─ Script: Sản phẩm
 ├─ Inputs: 2 dòng → 2 task mỗi lần chạy
 └─ Các lần chạy: lần 1 (job), lần 2 (job), …  →  Dữ liệu: products (3 dòng), kết quả (2 dòng)
```

**Dữ liệu** (collection `records`) lưu kết quả của mọi task chạy xong:

| Kết quả của task | Thành |
| --- | --- |
| Biến là mảng object (ví dụ `posts`) | Mỗi phần tử một dòng trong bộ `posts` |
| Biến là mảng giá trị đơn | Mỗi giá trị một dòng `{ value }` |
| Biến là object | Một dòng |
| Các biến giá trị đơn (title, price…) | Một dòng mỗi task trong bộ `kết quả` |

- Dữ liệu được nhóm theo **luồng** (hoặc theo **script** khi chạy ngoài luồng, ví dụ khi chạy thử).
- Mục có cùng `url` / `link` / `href` / `id` được **gộp** qua các lần chạy; mỗi dòng có thời điểm gặp lần đầu, lần cuối và số lần gặp.
- Dữ liệu **vẫn còn khi xoá job**; muốn xoá thì dùng nút *Xoá bộ dữ liệu* hoặc xoá từng dòng trên trang Dữ liệu.
- Tải về: **CSV** (mở bằng Excel, đúng tiếng Việt) hoặc **JSON**.

## 9. Luồng kéo dữ liệu từ nguồn

Khi tạo luồng, chọn **📥 Kéo dữ liệu từ nguồn có sẵn**: không cần viết script, chỉ cần thêm nguồn và nhập link / từ khoá (mỗi dòng một mục).

| Nguồn | Nhập | Lấy được | Đăng nhập |
| --- | --- | --- | --- |
| Website khác | link (+ từ khoá tuỳ chọn) | Không từ khoá: danh sách (hoặc nội dung) ngay tại link. Có từ khoá: gõ vào ô tìm kiếm của trang rồi lấy kết quả. Mỗi link × từ khoá là một task. | không cần |
| Facebook group | link group | bài mới nhất: tác giả, nội dung, link, thời gian, ảnh | **cần** profile đã đăng nhập |
| Google | từ khoá | tiêu đề, link, mô tả, trang (10 kết quả / trang) | nên có; hay hỏi captcha |
| YouTube | từ khoá | tiêu đề, link, kênh, lượt xem, ngày đăng, thời lượng, ảnh | không cần |
| TikTok | từ khoá | video: mô tả, link, tác giả, lượt xem | nên có; hay bắt kéo thanh trượt |
| Threads | từ khoá | tác giả, nội dung, link, thời gian | nên có (không đăng nhập chỉ thấy vài bài) |
| Shopee | từ khoá | tên, giá, link, ảnh | **cần** profile đã đăng nhập |

- Mỗi nguồn có: **số mục mỗi link / từ khoá** (mặc định 50), **Vào từng kết quả lấy chi tiết** (mặc định tắt, chậm hơn nhiều), **profile** (với trang cần đăng nhập; đăng nhập ngay trong thẻ nguồn), nút **▶ Chạy thử** (link / từ khoá đầu tiên, 5 mục, hiện cửa sổ Chrome) và **Xem script** (script được tạo tự động).
- Mỗi lần chạy luồng tạo **một job cho mỗi nguồn** (các job cùng lần chạy có chung `runId`), mỗi link / từ khoá là một task.
- Dữ liệu vào trang **Dữ liệu**, mỗi loại nguồn một bảng (`website`, `youtube`, `facebook`…), mỗi dòng có `source`, `keyword` / `from` / `group` cho biết lấy từ đâu; mục trùng url được gộp.
- Gặp **captcha / trang đăng nhập**, task chuyển sang *paused* với lời nhắc: mở task, bấm **Take control** để giải / đăng nhập ngay trên live view, rồi **Resume**.
