# Viết script

Tài liệu tham chiếu đầy đủ về định dạng script: các trường, biến, selector, toàn bộ action và tham số, điều kiện, kèm hướng dẫn viết một script từ đầu.
Khái niệm Script / Profile / Job / Task xem ở [khai-niem.md](khai-niem.md).

Mục lục:

1. [Định dạng script](#1-định-dạng-script)
2. [Biến `{{...}}`](#2-biến-)
3. [Selector](#3-selector)
4. [Tham số dùng chung cho mọi action](#4-tham-số-dùng-chung-cho-mọi-action)
5. [Danh sách action](#5-danh-sách-action)
6. [Điều kiện (`if`, `repeat while`)](#6-điều-kiện)
7. [Mẫu URL](#7-mẫu-url)
8. [Emulation](#8-emulation)
9. [Hướng dẫn viết một script bất kỳ](#9-hướng-dẫn-viết-một-script-bất-kỳ)
10. [Mẫu thường dùng](#10-mẫu-thường-dùng)
11. [Lỗi thường gặp](#11-lỗi-thường-gặp)

---

## 1. Định dạng script

Script là JSON. Trên UI (**Scripts → New script**) bạn điền từng phần vào các ô riêng; còn khi gọi API `POST /scripts`, toàn bộ script là một object:

```json
{
  "name": "Lấy câu trích dẫn",
  "description": "Lấy câu trích dẫn theo tag, đi qua nhiều trang",
  "defaultVars": { "tag": "love", "maxPages": 5 },
  "emulation": { "locale": "vi-VN" },
  "actions": [
    { "type": "goto", "url": "https://quotes.toscrape.com/tag/{{tag}}/" },
    { "type": "extract", "selector": ".quote .text", "multiple": true, "as": "quotes" }
  ]
}
```

| Trường | Bắt buộc | Kiểu | Ý nghĩa |
| --- | --- | --- | --- |
| `name` | có | chuỗi | Tên script |
| `description` | không | chuỗi | Mô tả |
| `actions` | có | mảng action | Các bước, chạy lần lượt từ trên xuống |
| `defaultVars` | không | object | Giá trị mặc định cho biến |
| `emulation` | không | object | Môi trường trình duyệt, xem [mục 8](#8-emulation) |

Mỗi action là một object có `type` và các tham số riêng của nó. **Không được thêm tham số lạ**: viết sai tên (ví dụ `selecter`) sẽ bị báo lỗi ngay khi lưu.

---

## 2. Biến `{{...}}`

Chuỗi nào trong action cũng có thể chứa biến.

| Cách viết | Kết quả |
| --- | --- |
| `"https://x.com/?q={{keyword}}"` | Chèn giá trị vào chuỗi |
| `"{{user.name}}"`, `"{{items.0}}"`, `"{{list.length}}"` | Đi vào object/mảng bằng dấu chấm |
| `"{{items}}"` (cả chuỗi chỉ có đúng một biến) | Giữ **nguyên kiểu** gốc: mảng vẫn là mảng, số vẫn là số |
| `"{{khong_ton_tai}}"` | Thành chuỗi rỗng |

Các tham số kiểu **số** (`times`, `ms`, `index`, `limit`, …) cũng nhận được biến, nhưng phải viết dạng **cả chuỗi chỉ có một biến**, ví dụ `"times": "{{maxPages}}"`.

### Biến đến từ đâu

Theo thứ tự ưu tiên tăng dần (nguồn sau đè nguồn trước):

1. `defaultVars` của script
2. **Shared variables** khi tạo job
3. **Dòng Inputs** của từng task (mỗi cột CSV là một biến)
4. Các biến được tạo **trong lúc chạy**:

| Tạo bởi | Tên biến |
| --- | --- |
| `extract` | `as` (mặc định `data`) |
| `evaluate` | `as` |
| `set` | `var` |
| `getCookies` | `as` (mặc định `cookies`) |
| `download` | `as` → `{ artifactId, filename }` |
| `captureResponses` | `as` |
| `repeat` | `as` (mặc định `$index`): số lần lặp, đếm từ 0 |
| `forEach` | `as` (mặc định `$item`) và `$index` |
| `try` | `$error`: thông báo lỗi khi vào nhánh `catch` |

### Kết quả của task

Biến tạo bởi `extract`, `evaluate`, `getCookies`, `download` và `captureResponses` được **lưu vào kết quả** của task (khung **Result**). Biến tạo bởi `set` chỉ dùng trong lúc chạy, không được lưu vào kết quả.

---

## 3. Selector

Các tham số `selector`, `source`, `target` dùng **selector của Playwright**:

| Dạng | Ví dụ |
| --- | --- |
| CSS | `#email`, `.product .price`, `input[name=q]`, `a[href*='/posts/']` |
| Theo chữ | `text=Đăng nhập`, `button:has-text("Tìm kiếm")`, `div[role=button]:text-is("Xem thêm")` |
| Theo role | `role=button[name="Gửi"]` |
| XPath | `xpath=//table//tr[2]/td[3]` |
| Nối chuỗi | `.card >> text=Mua ngay` |

- Nếu selector khớp nhiều phần tử, các action thao tác (`click`, `fill`, …) dùng **phần tử đầu tiên**.
- Trong `forEach` có `selector`, các selector bên trong được tìm **bên trong phần tử hiện tại**; `:scope` là chính phần tử đó.
- Trong `frame`, selector được tìm bên trong iframe.
- Riêng `fields` của `extract` dùng **CSS thuần** (chạy bằng `querySelectorAll` trong trang) để lấy nhanh trong một lần.

> **Nên** chọn selector ổn định: `id`, `name`, `data-*`, `aria-*`, `role`, chữ hiển thị.
> **Tránh** class sinh tự động kiểu `x1lliihq x6ikm8r`, vì chúng thay đổi sau mỗi lần trang cập nhật.

---

## 4. Tham số dùng chung cho mọi action

| Tham số | Kiểu | Ý nghĩa |
| --- | --- | --- |
| `timeout` | số (ms) | Thời gian chờ tối đa của bước này. Mặc định lấy **Step timeout** của job (30 giây) |
| `optional` | `true`/`false` | `true` thì lỗi được bỏ qua, ghi `skipped` và chạy tiếp |
| `label` | chuỗi | Tên hiển thị trong log, giúp dễ đọc |

```json
{ "type": "click", "selector": "#cookie-accept", "optional": true, "timeout": 3000, "label": "đóng banner cookie" }
```

---

## 5. Danh sách action

Ký hiệu: **in đậm** là tham số bắt buộc.

### 5.1 Điều hướng

| Action | Tham số | Ghi chú |
| --- | --- | --- |
| `goto` | **`url`**, `waitUntil` | Mở URL. `waitUntil`: `domcontentloaded` (mặc định), `load`, `networkidle`, `commit` |
| `back` | `waitUntil` | Quay lại trang trước |
| `forward` | `waitUntil` | Đi tới trang sau |
| `reload` | `waitUntil` | Tải lại trang |

```json
{ "type": "goto", "url": "https://example.com", "waitUntil": "networkidle" }
```

### 5.2 Tương tác

| Action | Tham số | Ghi chú |
| --- | --- | --- |
| `click` | **`selector`**, `button`, `modifiers`, `position`, `force`, `waitForNavigation` | `button`: `left`/`right`/`middle`. `modifiers`: `["Control","Shift","Alt","Meta"]`. `position`: `{ "x": 5, "y": 5 }` (tính trong phần tử). `force: true` bỏ qua kiểm tra phần tử có bấm được không. `waitForNavigation: true` chờ trang chuyển sau khi bấm |
| `dblclick` | **`selector`**, `button`, `position`, `force` | Nhấp đúp |
| `hover` | **`selector`** | Rê chuột lên phần tử |
| `focus` | **`selector`** | Đặt con trỏ vào phần tử |
| `fill` | **`selector`**, **`value`** | Điền ngay toàn bộ giá trị vào ô nhập (xoá giá trị cũ) |
| `clear` | **`selector`** | Xoá ô nhập |
| `type` | **`text`**, `selector`, `delay` | Gõ từng phím như người thật. Không có `delay` thì mỗi phím cách nhau ngẫu nhiên 50–150ms. Có `selector` thì focus vào phần tử trước khi gõ |
| `press` | **`key`**, `selector` | Nhấn phím: `Enter`, `Tab`, `Escape`, `ArrowDown`, `Backspace`, `Control+A`, `Shift+Tab`, … |
| `check` | **`selector`** | Tick checkbox/radio |
| `uncheck` | **`selector`** | Bỏ tick checkbox |
| `select` | **`selector`**, **`value`** | Chọn option của `<select>` theo value hoặc chữ hiển thị. `value` là chuỗi, hoặc mảng nếu chọn nhiều |
| `upload` | **`selector`**, **`files`** | Gán file cho `<input type=file>`. `files`: mảng đường dẫn trên máy, ví dụ `["D:/anh/1.jpg"]` |
| `drag` | **`source`**, **`target`** | Kéo phần tử `source` thả vào `target` |
| `scroll` | `selector`, `to`, `x`, `y`, `untilEnd`, `maxScrolls` | Xem bảng bên dưới |
| `mouse` | **`x`**, **`y`**, `click` | Di chuột tới toạ độ trên trang (pixel); `click: true` để nhấp luôn |

Các cách dùng `scroll`:

| Viết | Tác dụng |
| --- | --- |
| `{ "type": "scroll" }` | Lăn chuột xuống 600px |
| `{ "type": "scroll", "y": 2500 }` | Lăn xuống 2500px (số âm là lăn lên; `x` là lăn ngang) |
| `{ "type": "scroll", "to": "bottom" }` | Nhảy xuống cuối trang (`top` là lên đầu) |
| `{ "type": "scroll", "untilEnd": true, "maxScrolls": 30 }` | Cuộn liên tục tới khi trang không tải thêm nội dung (feed vô hạn); tối đa `maxScrolls` lần (mặc định 30) |
| `{ "type": "scroll", "selector": "#list" }` | Cuộn trang tới khi thấy phần tử |
| `{ "type": "scroll", "selector": "#list", "to": "bottom" }` | Cuộn **bên trong** phần tử (khung có thanh cuộn riêng) |

### 5.3 Chờ

| Action | Tham số | Ghi chú |
| --- | --- | --- |
| `waitFor` | `selector`, `state`, `url`, `loadState`, `response` | Dùng một hoặc nhiều tham số cùng lúc. `state`: `visible` (mặc định), `hidden`, `attached`, `detached`. `url`: chờ địa chỉ trang khớp [mẫu URL](#7-mẫu-url). `loadState`: `load`, `domcontentloaded`, `networkidle`. `response`: chờ một request mạng khớp mẫu URL |
| `sleep` | **`ms`**, `jitter` | Nghỉ `ms` mili giây, cộng thêm ngẫu nhiên 0–`jitter` ms |
| `pause` | `message` | Dừng task, chờ người bấm **Resume** trên UI (giải captcha, nhập OTP…). Trong lúc dừng có thể bật **Take control** để thao tác tay |

```json
{ "type": "waitFor", "selector": ".result", "state": "visible", "timeout": 15000 }
{ "type": "waitFor", "response": "/api/search" }
{ "type": "sleep", "ms": 2000, "jitter": 1000 }
```

### 5.4 Dữ liệu

| Action | Tham số | Ghi chú |
| --- | --- | --- |
| `extract` | **`selector`**, `fields`, `get`, `multiple`, `as` | Lấy dữ liệu vào biến `as` (mặc định `data`). Xem chi tiết bên dưới |
| `screenshot` | `selector`, `fullPage`, `name` | Chụp ảnh PNG, lưu vào Artifacts. Có `selector` thì chỉ chụp phần tử đó; `fullPage: true` chụp cả trang |
| `pdf` | `name` | Lưu trang thành PDF (**chỉ chạy ở chế độ headless**) |
| `download` | **`selector`**, `name`, `as` | Bấm vào phần tử để tải file về, lưu vào Artifacts. `as` nhận `{ artifactId, filename }` |
| `getCookies` | `as`, `urls` | Đọc cookie vào biến (mặc định `cookies`). `urls` để lọc theo trang |
| `setCookies` | **`cookies`** | Thêm cookie. Mỗi cookie cần `name`, `value`, và `url` (hoặc `domain` + `path`) |
| `clearCookies` | | Xoá toàn bộ cookie |
| `evaluate` | **`script`**, `arg`, `as` | Chạy JavaScript trong trang. Xem chi tiết bên dưới |
| `set` | **`var`**, **`value`** | Gán biến. `value` là bất kỳ giá trị JSON nào |
| `log` | **`message`** | Ghi một dòng vào log (dùng được biến) |

#### `extract` chi tiết

`get` chọn loại dữ liệu lấy ra từ phần tử:

| `get` | Lấy gì |
| --- | --- |
| `text` (mặc định) | Chữ hiển thị (đã bỏ khoảng trắng hai đầu) |
| `html` | HTML bên trong |
| `outerHtml` | HTML gồm cả thẻ |
| `value` | Giá trị ô nhập |
| `attr:<tên>` | Thuộc tính đúng như viết trong HTML, ví dụ `attr:href` có thể là `/a/b` |
| `prop:<tên>` | Thuộc tính DOM, ví dụ `prop:href` cho URL đầy đủ, `prop:src`, `prop:checked` |

Bốn dạng hay dùng:

```json
{ "type": "extract", "selector": "h1", "as": "title" }
```
→ `"title": "Tiêu đề"` (một giá trị)

```json
{ "type": "extract", "selector": ".product a", "multiple": true, "get": "prop:href", "as": "links" }
```
→ `"links": ["https://…", "https://…"]` (danh sách)

```json
{
  "type": "extract",
  "selector": ".product",
  "multiple": true,
  "fields": {
    "name": ".name",
    "price": ".price",
    "url": { "selector": "a", "get": "prop:href" },
    "image": { "selector": "img", "get": "prop:src" },
    "tags": { "selector": ".tag", "multiple": true },
    "id": { "get": "attr:data-id" }
  },
  "as": "products"
}
```
→ `"products": [{ "name": "…", "price": "…", "url": "…", "image": "…", "tags": ["…"], "id": "…" }, …]`

- Mỗi field là một chuỗi (CSS selector, lấy `text`) hoặc một object `{ selector, get, multiple }`.
- Field không có `selector`, hoặc có `selector` là `":scope"`, nghĩa là lấy từ chính phần tử đang xét.
- Field không tìm thấy thì có giá trị `null`.
- Khi **không** có `multiple` mà selector không khớp phần tử nào thì bước đó **lỗi**. Thêm `"optional": true` nếu chấp nhận việc không có.

#### `evaluate` chi tiết

`script` nhận một trong hai dạng:

- **Thân hàm**, dùng `return` để trả kết quả. Bên trong dùng được biến `vars` (toàn bộ biến hiện có), `arg`, và `await`:
  ```json
  { "type": "evaluate", "script": "return document.title.toUpperCase()", "as": "title" }
  { "type": "evaluate", "script": "return [...vars.all, ...vars.page]", "as": "all" }
  ```
- **Hàm hoàn chỉnh**, được gọi với tham số `(arg, vars)`:
  ```json
  { "type": "evaluate", "script": "(arg) => document.querySelectorAll(arg).length", "arg": ".item", "as": "count" }
  ```

Lưu ý khi viết JS bên trong chuỗi JSON: dấu `"` phải viết thành `\"`, nên dễ nhất là dùng dấu nháy đơn `'` hoặc backtick trong JS. Xuống dòng viết là `\n`.

### 5.5 Mạng

| Action | Tham số | Ghi chú |
| --- | --- | --- |
| `blockResources` | **`resourceTypes`** | Chặn tải các loại tài nguyên để chạy nhanh hơn: `image`, `media`, `font`, `stylesheet`, `script`, `xhr`, `fetch`, `websocket`, `other`, … Đặt **trước** `goto` |
| `intercept` | **`url`**, `abort`, `fulfill` | Request khớp [mẫu URL](#7-mẫu-url) sẽ bị chặn (`abort: true`) hoặc trả về dữ liệu giả (`fulfill: { status, contentType, body }`) |
| `captureResponses` | **`url`**, **`as`**, `json` | Từ bước này trở đi, gom các response có URL khớp mẫu vào danh sách `as`. `json: true` để lấy luôn nội dung JSON (`body`). Hữu ích khi trang tải dữ liệu qua API |

```json
{ "type": "blockResources", "resourceTypes": ["image", "media", "font"] }
{ "type": "captureResponses", "url": "/api/products", "as": "apiData", "json": true }
```

### 5.6 Tab, iframe, hộp thoại

| Action | Tham số | Ghi chú |
| --- | --- | --- |
| `newTab` | `url` | Mở tab mới và chuyển sang tab đó |
| `switchTab` | **`index`** | Chuyển sang tab theo số thứ tự (bắt đầu từ 0). Dùng khi một link tự mở tab mới |
| `closeTab` | `index` | Đóng tab (mặc định là tab hiện tại) rồi chuyển sang tab còn lại |
| `frame` | **`selector`**, **`actions`** | Chạy các action con bên trong iframe |
| `dialog` | **`accept`**, `promptText` | Cách xử lý hộp thoại `alert`/`confirm`/`prompt` từ bước này trở đi. Mặc định là bấm Huỷ |

```json
{ "type": "frame", "selector": "iframe#payment", "actions": [
  { "type": "fill", "selector": "#card", "value": "{{card}}" }
] }
{ "type": "dialog", "accept": true }
```

### 5.7 Điều khiển luồng

| Action | Tham số | Ghi chú |
| --- | --- | --- |
| `if` | **`condition`**, **`then`**, `else` | Rẽ nhánh theo [điều kiện](#6-điều-kiện) |
| `repeat` | **`actions`**, `times`, `while`, `maxIterations`, `as` | Lặp `times` lần, và/hoặc lặp khi `while` còn đúng. Số lần lặp nằm trong biến `as` (mặc định `$index`, đếm từ 0). Nếu chỉ có `while` thì tối đa `maxIterations` lần (mặc định 1000) |
| `forEach` | **`actions`**, `selector` hoặc `items`, `as`, `limit` | Lặp qua từng phần tử khớp `selector` (selector bên trong tìm trong phần tử đó), hoặc qua từng phần tử của mảng `items` (ví dụ `"{{links}}"`). Phần tử hiện tại nằm trong `as` (mặc định `$item`), vị trí nằm trong `$index`. `limit` giới hạn số vòng |
| `try` | **`actions`**, `catch` | Chạy `actions`; nếu lỗi thì chạy `catch` thay vì làm task thất bại. Thông báo lỗi nằm trong `$error` |
| `break` | | Thoát vòng `repeat`/`forEach` gần nhất |
| `stop` | `message` | Kết thúc task **thành công** ngay tại đây |

```json
{ "type": "if", "condition": { "exists": ".captcha" },
  "then": [{ "type": "pause", "message": "Giải captcha rồi bấm Resume" }] }

{ "type": "forEach", "items": "{{links}}", "as": "link", "limit": 20, "actions": [
  { "type": "goto", "url": "{{link}}" },
  { "type": "extract", "selector": "h1", "as": "title" }
] }

{ "type": "try",
  "actions": [{ "type": "click", "selector": "text=Tải thêm", "timeout": 3000 }],
  "catch": [{ "type": "log", "message": "Không có nút tải thêm: {{$error}}" }] }
```

---

## 6. Điều kiện

Dùng trong `if.condition` và `repeat.while`. Mỗi object điều kiện chỉ nên có **một** loại kiểm tra:

| Điều kiện | Đúng khi |
| --- | --- |
| `{ "exists": "<selector>" }` | Có ít nhất một phần tử khớp |
| `{ "visible": "<selector>" }` | Phần tử đầu tiên khớp đang hiển thị |
| `{ "urlIncludes": "checkout" }` | Địa chỉ trang hiện tại chứa chuỗi này |
| `{ "textIncludes": { "selector": ".msg", "text": "Thành công" } }` | Chữ của phần tử (bỏ `selector` thì xét cả trang) chứa `text` |
| `{ "var": "items" }` | Biến có giá trị "đúng" (khác rỗng, khác 0, khác `false`; với mảng là có ít nhất một phần tử) |
| `{ "var": "status", "equals": "ok" }` | Biến bằng đúng giá trị này |
| `{ "js": "vars.count > 10 && location.href.includes('page')" }` | Biểu thức JavaScript trả về đúng (chạy trong trang, có `vars`) |
| `{ "not": { … } }` | Phủ định |
| `{ "all": [ {…}, {…} ] }` | Tất cả điều kiện đều đúng |
| `{ "any": [ {…}, {…} ] }` | Có ít nhất một điều kiện đúng |

```json
{ "type": "repeat", "while": { "exists": "button.load-more" }, "maxIterations": 50, "actions": [
  { "type": "click", "selector": "button.load-more" },
  { "type": "sleep", "ms": 1500 }
] }
```

---

## 7. Mẫu URL

Dùng trong `waitFor.url`, `waitFor.response`, `intercept.url`, `captureResponses.url`:

| Mẫu | Khớp với |
| --- | --- |
| `/api/search` | URL **chứa** chuỗi này |
| `**/api/*.json` | Glob: `*` là một đoạn đường dẫn, `**` là nhiều đoạn |
| `/\/product\/\d+/i` | Biểu thức chính quy, viết trong cặp `/.../` (có thể kèm cờ) |

---

## 8. Emulation

Đặt trong `emulation` của script hoặc profile. Khi job chạy, emulation của **script**, **profile** và **job** được gộp lại, cái sau đè cái trước.

| Trường | Ví dụ | Ý nghĩa |
| --- | --- | --- |
| `viewport` | `{ "width": 1440, "height": 900 }` | Kích thước khung trang. Mặc định 1366×768 |
| `userAgent` | `"Mozilla/5.0 …"` | Đổi user-agent |
| `locale` | `"vi-VN"` | Ngôn ngữ trình duyệt |
| `timezoneId` | `"Asia/Ho_Chi_Minh"` | Múi giờ |
| `geolocation` | `{ "latitude": 21.03, "longitude": 105.85 }` | Vị trí GPS (cần thêm `permissions`) |
| `permissions` | `["geolocation", "notifications"]` | Quyền được cấp sẵn |
| `colorScheme` | `"dark"` | `light` / `dark` / `no-preference` |
| `proxy` | `{ "server": "http://host:8080", "username": "u", "password": "p" }` | Proxy |
| `extraHTTPHeaders` | `{ "X-Token": "abc" }` | Header gửi kèm mọi request |
| `ignoreHTTPSErrors` | `true` | Bỏ qua lỗi chứng chỉ HTTPS |
| `javaScriptEnabled` | `false` | Tắt JavaScript |

---

## 9. Hướng dẫn viết một script bất kỳ

Ví dụ đi xuyên suốt: lấy toàn bộ câu trích dẫn theo một chủ đề trên [quotes.toscrape.com](https://quotes.toscrape.com), đi qua nhiều trang. Script này đã được chạy thử thực tế.

### Bước 1: Xác định mục tiêu

Ghi ra theo thứ tự: mở trang nào, cần thao tác gì (đăng nhập, tìm kiếm, bấm, cuộn), lấy dữ liệu gì, lặp ra sao (nhiều trang, nhiều link), và cái gì thay đổi giữa các lần chạy (sẽ thành biến).

> Mở `https://quotes.toscrape.com/tag/<chủ đề>/`, lấy từng câu (nội dung, tác giả, link tác giả, các tag), bấm **Next** tới trang cuối. Biến: `tag`, `maxPages`.

### Bước 2: Tìm selector

**Cách A: DevTools.** Mở trang bằng Chrome, chuột phải vào phần tử, chọn **Inspect**. Tìm `id`/`class`/thuộc tính ổn định. Thử selector trong tab **Console**:

```js
document.querySelectorAll('.quote').length      // 10
document.querySelector('.quote .author').innerText
document.querySelector('li.next a')             // nút Next
```

**Cách B: Playwright codegen**, ghi lại thao tác và tự gợi ý selector. Chạy trong thư mục dự án:

```bash
npx playwright codegen --channel chrome https://quotes.toscrape.com
```

Bạn thao tác trên cửa sổ Chrome hiện ra; cửa sổ bên cạnh hiện code kiểu `page.getByRole('link', { name: 'Next' }).click()`. Đổi sang action tương ứng, ví dụ `{ "type": "click", "selector": "role=link[name=\"Next\"]" }`.

Kết quả với trang ví dụ:

| Cần lấy | Selector |
| --- | --- |
| Mỗi câu trích dẫn | `.quote` |
| Nội dung / tác giả | `.text` / `.author` (bên trong `.quote`) |
| Link tác giả | `a[href*='/author/']` → `prop:href` |
| Các tag | `.tag` (nhiều) |
| Nút trang sau | `li.next a` |

### Bước 3: Viết bản đơn giản nhất và chạy thử

Bắt đầu với 2–3 bước, chạy thử ngay để chắc selector đúng:

```json
[
  { "type": "goto", "url": "https://quotes.toscrape.com/tag/love/" },
  { "type": "extract", "selector": ".quote .text", "multiple": true, "as": "texts" }
]
```

Trên trang script, bấm **Save & test run (headed)**. Xem log và **Result**; nếu `texts` có dữ liệu thì selector đúng.

### Bước 4: Lấy đủ dữ liệu bằng `fields`

```json
{
  "type": "extract",
  "selector": ".quote",
  "multiple": true,
  "fields": {
    "text": ".text",
    "author": ".author",
    "authorUrl": { "selector": "a[href*='/author/']", "get": "prop:href" },
    "tags": { "selector": ".tag", "multiple": true }
  },
  "as": "quotes"
}
```

### Bước 5: Thêm vòng lặp, rồi đổi giá trị cố định thành biến

Đi qua nhiều trang bằng `repeat`; gom kết quả từng trang vào biến `all`; dừng khi không còn nút Next:

```json
[
  { "type": "goto", "url": "https://quotes.toscrape.com/tag/{{tag}}/" },
  { "type": "set", "var": "all", "value": [] },
  {
    "type": "repeat",
    "times": "{{maxPages}}",
    "as": "trang",
    "actions": [
      { "type": "waitFor", "selector": ".quote" },
      {
        "type": "extract",
        "selector": ".quote",
        "multiple": true,
        "fields": {
          "text": ".text",
          "author": ".author",
          "authorUrl": { "selector": "a[href*='/author/']", "get": "prop:href" },
          "tags": { "selector": ".tag", "multiple": true }
        },
        "as": "quotes"
      },
      { "type": "evaluate", "script": "return [...vars.all, ...vars.quotes]", "as": "all" },
      { "type": "log", "message": "Trang {{trang}}: tổng {{all.length}} câu" },
      { "type": "if", "condition": { "not": { "exists": "li.next a" } }, "then": [{ "type": "break" }] },
      { "type": "click", "selector": "li.next a", "waitForNavigation": true }
    ]
  },
  { "type": "screenshot", "name": "trang-cuoi" }
]
```

`defaultVars`:

```json
{ "tag": "love", "maxPages": 5 }
```

Kết quả chạy thật: log ghi `Trang 0: tổng 10 câu`, `Trang 1: tổng 14 câu`, rồi dừng vì hết nút Next. `result.all` chứa 14 câu:

```json
{ "text": "“It is better to be hated for what you are than to be loved for what you are not.”",
  "author": "André Gide",
  "authorUrl": "https://quotes.toscrape.com/author/Andre-Gide",
  "tags": ["life", "love"] }
```

### Bước 6: Gia cố cho chạy ổn định

- Thêm `waitFor` trước khi `extract` hoặc `click` ở những chỗ nội dung tải chậm.
- Thêm `sleep` kèm `jitter` giữa các thao tác với trang dễ chặn bot.
- Banner cookie hay popup chỉ thỉnh thoảng xuất hiện: dùng `"optional": true` hoặc `try`.
- Gặp captcha, OTP: dùng `if` + `pause`.
- Trang nặng: đặt `blockResources` (`image`, `media`, `font`) trước `goto`.

### Bước 7: Chạy hàng loạt bằng job

**New job**, chọn script, điền Inputs. Mỗi dòng là một task, mỗi cột là một biến:

```
name,tag,maxPages
Love,love,5
Life,life,3
Humor,humor,3
```

Đặt Concurrency = 3 để chạy 3 Chrome song song, rồi bấm **Start**.

---

## 10. Mẫu thường dùng

**Đăng nhập rồi kiểm tra:**

```json
[
  { "type": "goto", "url": "https://example.com/login" },
  { "type": "fill", "selector": "input[name=email]", "value": "{{email}}" },
  { "type": "fill", "selector": "input[name=password]", "value": "{{password}}" },
  { "type": "click", "selector": "button[type=submit]", "waitForNavigation": true },
  { "type": "if", "condition": { "urlIncludes": "/login" },
    "then": [{ "type": "pause", "message": "Đăng nhập chưa thành công, xử lý tay rồi Resume" }] }
]
```

**Tìm kiếm:**

```json
[
  { "type": "goto", "url": "https://example.com" },
  { "type": "type", "selector": "input[name=q]", "text": "{{keyword}}" },
  { "type": "press", "key": "Enter" },
  { "type": "waitFor", "selector": ".result" },
  { "type": "extract", "selector": ".result", "multiple": true,
    "fields": { "title": "h3", "url": { "selector": "a", "get": "prop:href" } }, "as": "results" }
]
```

**Lấy danh sách link rồi vào từng trang chi tiết:**

```json
[
  { "type": "goto", "url": "{{url}}" },
  { "type": "extract", "selector": ".product a.title", "multiple": true, "get": "prop:href", "as": "links" },
  { "type": "set", "var": "details", "value": [] },
  { "type": "forEach", "items": "{{links}}", "as": "link", "limit": 20, "actions": [
    { "type": "goto", "url": "{{link}}" },
    { "type": "extract", "selector": "body",
      "fields": { "name": "h1", "price": ".price", "desc": ".description" }, "as": "item" },
    { "type": "evaluate", "script": "return [...vars.details, { ...vars.item, url: vars.link }]", "as": "details" },
    { "type": "sleep", "ms": 1000, "jitter": 1000 }
  ] }
]
```

**Cuộn feed vô hạn rồi lấy dữ liệu:**

```json
[
  { "type": "goto", "url": "{{url}}" },
  { "type": "scroll", "untilEnd": true, "maxScrolls": 20 },
  { "type": "extract", "selector": "article", "multiple": true, "fields": { "title": "h2" }, "as": "posts" }
]
```

**Lấy dữ liệu từ API của trang thay vì đọc giao diện:**

```json
[
  { "type": "captureResponses", "url": "/api/v1/products", "as": "responses", "json": true },
  { "type": "goto", "url": "{{url}}" },
  { "type": "waitFor", "response": "/api/v1/products" },
  { "type": "sleep", "ms": 1000 }
]
```

**Chụp màn hình nhiều trang** (Inputs có cột `url`, mỗi dòng một task):

```json
[
  { "type": "blockResources", "resourceTypes": ["media"] },
  { "type": "goto", "url": "{{url}}", "waitUntil": "networkidle" },
  { "type": "screenshot", "fullPage": true, "name": "{{name}}" }
]
```

---

## 11. Lỗi thường gặp

| Hiện tượng | Nguyên nhân và cách sửa |
| --- | --- |
| Lưu script báo `must NOT have additional properties (xxx)` | Viết sai tên tham số `xxx`, hoặc action đó không có tham số này. Bấm Ctrl+Space để xem tên đúng |
| Lưu script báo `must have required property 'yyy'` | Thiếu tham số bắt buộc `yyy` |
| Bước lỗi `Timeout … exceeded` | Selector sai hoặc phần tử xuất hiện chậm. Kiểm tra selector bằng DevTools, thêm `waitFor`, hoặc tăng `timeout` |
| `No element matches …` (`extract`) | Không tìm thấy phần tử. Kiểm tra selector, hoặc thêm `"optional": true` |
| Bấm hoặc điền nhầm phần tử | Selector khớp nhiều phần tử nên action dùng phần tử **đầu tiên**. Làm selector cụ thể hơn |
| Lấy được chữ bị cắt ("Xem thêm") | Bấm mở rộng trước khi `extract` |
| `pdf` báo lỗi | `pdf` chỉ chạy ở chế độ headless |
| Kết quả rỗng ở trang cần đăng nhập | Chạy job với profile đã đăng nhập |
| Lỗi ở bước nằm trong vòng lặp | Log ghi đường dẫn bước dạng `3.actions.2`: bước 2 trong `actions` của bước 3. Task lỗi có ảnh chụp màn hình lúc lỗi trong mục Artifacts |
