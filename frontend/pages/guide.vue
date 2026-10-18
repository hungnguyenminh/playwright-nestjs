<script setup lang="ts">
import { Document, List, Tickets, User } from '@element-plus/icons-vue';

const route = useRoute();
const router = useRouter();
const TABS = ['concepts', 'howto', 'actions'] as const;
const tab = computed({
  get: () => (TABS.includes(route.query.tab as any) ? (route.query.tab as string) : 'concepts'),
  set: (v) => router.replace({ query: { ...route.query, tab: v } }),
});

// ---- examples (kept as strings: `{{…}}` would otherwise be parsed by Vue) ----

const QUOTES_SCRIPT = {
  name: 'Lấy câu trích dẫn',
  description: 'Lấy câu trích dẫn theo tag, đi qua nhiều trang',
  defaultVars: { tag: 'love', maxPages: 5 },
  actions: [
    { type: 'goto', url: 'https://quotes.toscrape.com/tag/{{tag}}/' },
    { type: 'set', var: 'all', value: [] },
    {
      type: 'repeat',
      times: '{{maxPages}}',
      as: 'trang',
      actions: [
        { type: 'waitFor', selector: '.quote' },
        {
          type: 'extract',
          selector: '.quote',
          multiple: true,
          fields: {
            text: '.text',
            author: '.author',
            tags: { selector: '.tag', multiple: true },
          },
          as: 'quotes',
        },
        { type: 'evaluate', script: 'return [...vars.all, ...vars.quotes]', as: 'all' },
        { type: 'log', message: 'Trang {{trang}}: tổng {{all.length}} câu' },
        { type: 'if', condition: { not: { exists: 'li.next a' } }, then: [{ type: 'break' }] },
        { type: 'click', selector: 'li.next a', waitForNavigation: true },
      ],
    },
  ],
};
const quotesActions = JSON.stringify(QUOTES_SCRIPT.actions, null, 2);
const quotesVars = JSON.stringify(QUOTES_SCRIPT.defaultVars, null, 2);

const SIMPLE = `[
  { "type": "goto", "url": "{{url}}" },
  { "type": "extract", "selector": "h1", "as": "title" },
  { "type": "screenshot", "name": "trang" }
]`;

const INPUTS_CSV = `name,tag,maxPages
Love,love,5
Life,life,3
Humor,humor,3`;

const FB_INPUTS = `name,url,scrolls
Cầu lông HN,https://www.facebook.com/groups/1382395589878960?sorting_setting=CHRONOLOGICAL,20`;

const LOGIN_PAUSE = `{ "type": "if", "condition": { "exists": ".captcha" },
  "then": [{ "type": "pause", "message": "Giải captcha rồi bấm Resume" }] }`;

const RESULT_SAMPLE = `{
  "text": "“It is better to be hated for what you are than to be loved for what you are not.”",
  "author": "André Gide",
  "tags": ["life", "love"]
}`;

/** Opens the script editor pre-filled with the example. */
function useTemplate() {
  sessionStorage.setItem('script-template', JSON.stringify(QUOTES_SCRIPT));
  navigateTo('/scripts/new');
}

// ---- action reference, built from the live JSON Schema ------------------------

interface ParamRow {
  name: string;
  required: boolean;
  type: string;
}
interface ActionRow {
  type: string;
  description: string;
  params: ParamRow[];
}

const COMMON = new Set(['type', 'timeout', 'optional', 'label']);
const GROUPS: Record<string, string[]> = {
  'Điều hướng': ['goto', 'back', 'forward', 'reload'],
  'Tương tác': ['click', 'dblclick', 'hover', 'focus', 'fill', 'clear', 'type', 'press', 'check', 'uncheck', 'select', 'upload', 'drag', 'scroll', 'mouse'],
  'Chờ': ['waitFor', 'sleep', 'pause'],
  'Dữ liệu': ['extract', 'screenshot', 'pdf', 'download', 'getCookies', 'setCookies', 'clearCookies', 'evaluate', 'set', 'log'],
  'Không cần selector': ['dismissOverlays', 'searchSite', 'collect', 'extractAuto'],
  'Mạng': ['blockResources', 'intercept', 'captureResponses'],
  'Tab, iframe': ['newTab', 'switchTab', 'closeTab', 'frame', 'dialog'],
  'Điều khiển luồng': ['if', 'repeat', 'forEach', 'try', 'break', 'stop'],
};

/** Vietnamese descriptions; the schema's English text is the fallback. */
const VI: Record<string, string> = {
  goto: 'Mở một URL. waitUntil mặc định là domcontentloaded',
  back: 'Quay lại trang trước',
  forward: 'Đi tới trang sau',
  reload: 'Tải lại trang',
  click: 'Bấm vào phần tử (phần tử đầu tiên khớp). waitForNavigation: chờ trang chuyển sau khi bấm',
  dblclick: 'Nhấp đúp vào phần tử',
  hover: 'Rê chuột lên phần tử',
  focus: 'Đặt con trỏ vào phần tử',
  fill: 'Điền ngay toàn bộ giá trị vào ô nhập (xoá giá trị cũ)',
  clear: 'Xoá nội dung ô nhập',
  type: 'Gõ từng phím như người thật (mặc định mỗi phím cách 50–150ms ngẫu nhiên)',
  press: 'Nhấn phím: Enter, Tab, Escape, ArrowDown, Control+A…',
  check: 'Tick checkbox/radio',
  uncheck: 'Bỏ tick checkbox',
  select: 'Chọn option của <select> theo value hoặc chữ hiển thị',
  upload: 'Gán file trên máy cho <input type=file>',
  drag: 'Kéo phần tử source thả vào target',
  scroll: 'Cuộn: lăn x/y px, tới top/bottom, tới phần tử, hoặc untilEnd (cuộn tới khi hết nội dung mới)',
  mouse: 'Di chuột tới toạ độ trên trang, click: true để nhấp',
  waitFor: 'Chờ phần tử (state), URL, trạng thái tải trang hoặc một response mạng',
  sleep: 'Nghỉ ms mili giây, cộng thêm ngẫu nhiên 0–jitter ms',
  pause: 'Dừng task, chờ người bấm Resume (giải captcha, nhập OTP…)',
  extract: 'Lấy dữ liệu vào biến as (mặc định data). multiple: lấy danh sách; fields: lấy nhiều trường',
  screenshot: 'Chụp ảnh PNG (cả trang với fullPage, hoặc một phần tử), lưu vào Artifacts',
  pdf: 'Lưu trang thành PDF (chỉ chạy ở chế độ headless)',
  download: 'Bấm phần tử để tải file về, lưu vào Artifacts',
  getCookies: 'Đọc cookie vào biến (mặc định cookies)',
  setCookies: 'Thêm cookie (mỗi cookie cần name, value và url hoặc domain + path)',
  clearCookies: 'Xoá toàn bộ cookie',
  evaluate: 'Chạy JavaScript trong trang (thân hàm có return, hoặc hàm (arg, vars) => …)',
  set: 'Gán giá trị cho biến',
  log: 'Ghi một dòng vào log',
  blockResources: 'Chặn tải các loại tài nguyên (image, media, font…) để chạy nhanh hơn',
  intercept: 'Chặn hoặc trả dữ liệu giả cho request khớp mẫu URL',
  dismissOverlays: 'Đóng / ẩn popup khuyến mãi, banner cookie đang che trang',
  searchSite: 'Tự tìm ô tìm kiếm của trang, gõ query rồi tìm (query rỗng thì bỏ qua)',
  collect: 'Như extract multiple nhưng tự cuộn / bấm Xem thêm đến khi đủ limit mục (mặc định 50), gộp trùng theo url',
  extractAuto: 'Tự nhận ra danh sách (sản phẩm, bài viết, kết quả) hoặc nội dung bài viết, không cần selector',
  captureResponses: 'Gom các response có URL khớp mẫu vào biến (json: lấy nội dung JSON)',
  newTab: 'Mở tab mới và chuyển sang tab đó',
  switchTab: 'Chuyển sang tab theo số thứ tự (từ 0)',
  closeTab: 'Đóng tab (mặc định tab hiện tại)',
  frame: 'Chạy các action con bên trong iframe',
  dialog: 'Cách trả lời hộp thoại alert/confirm/prompt từ bước này trở đi',
  if: 'Rẽ nhánh theo điều kiện: then / else',
  repeat: 'Lặp times lần và/hoặc khi while còn đúng; số vòng nằm trong as (mặc định $index)',
  forEach: 'Lặp qua từng phần tử (selector) hoặc từng giá trị của mảng (items); giá trị trong as (mặc định $item)',
  try: 'Chạy actions; nếu lỗi thì chạy catch (lỗi nằm trong $error) thay vì làm task thất bại',
  break: 'Thoát vòng repeat/forEach gần nhất',
  stop: 'Kết thúc task thành công ngay tại đây',
};

function describeType(s: any): string {
  if (!s || !Object.keys(s).length) return 'bất kỳ';
  if (s.$ref?.endsWith('/actions')) return 'danh sách action';
  if (s.$ref?.endsWith('/condition')) return 'điều kiện';
  if (s.const) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((v: unknown) => JSON.stringify(v)).join(' | ');
  if (s.anyOf) {
    // number-or-variable: show once
    const kinds = s.anyOf.map((x: any) => (x.pattern ? '"{{biến}}"' : describeType(x)));
    return [...new Set(kinds)].join(' | ');
  }
  if (s.type === 'array') return `[${describeType(s.items)}]`;
  if (s.type === 'object') {
    if (s.properties) return `{ ${Object.keys(s.properties).join(', ')} }`;
    return 'object';
  }
  if (s.type === 'integer') return 'số nguyên';
  if (s.type === 'number') return 'số';
  if (s.type === 'string') return 'chuỗi';
  if (s.type === 'boolean') return 'true | false';
  return String(s.type ?? '');
}

const { api } = useApi();
const actionRows = ref<ActionRow[]>([]);
const filter = ref('');

onMounted(async () => {
  const schema = await tryApi(() => api<any>('/actions/schema'));
  const variants: any[] = schema?.definitions?.action?.oneOf ?? [];
  actionRows.value = variants.map((v) => ({
    type: v.properties.type.const,
    description: VI[v.properties.type.const] ?? v.description,
    params: Object.entries(v.properties)
      .filter(([k]) => !COMMON.has(k))
      .map(([name, s]) => ({ name, required: v.required.includes(name), type: describeType(s) })),
  }));
});

const groupedActions = computed(() => {
  const q = filter.value.trim().toLowerCase();
  const match = (a: ActionRow) =>
    !q || a.type.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
  return Object.entries(GROUPS)
    .map(([group, types]) => ({
      group,
      rows: types
        .map((t) => actionRows.value.find((a) => a.type === t))
        .filter((a): a is ActionRow => !!a && match(a)),
    }))
    .filter((g) => g.rows.length);
});
</script>

<template>
  <div class="page !max-w-6xl">
    <PageHeader title="Hướng dẫn" subtitle="Khái niệm, cách dùng từng bước và tra cứu mọi action của script." />

    <el-tabs v-model="tab" class="guide rounded-xl border border-slate-200/70 bg-white px-6 pb-6 pt-2 shadow-sm">
      <!-- ============================== KHÁI NIỆM ============================== -->
      <el-tab-pane label="Khái niệm" name="concepts">
        <p class="text-gray-600">
          Tool gồm 4 khái niệm. <b>Script</b> nói <i>làm gì</i>, <b>Profile</b> nói <i>chạy bằng người dùng Chrome nào</i>,
          <b>Job</b> nói <i>chạy thế nào</i>, còn mỗi <b>Task</b> là <i>một lần chạy cho một đầu vào</i>.
        </p>

        <pre class="overflow-auto rounded bg-gray-50 p-4 text-xs leading-5 text-gray-700">
 Script ──────────┐   "làm gì trên trang"
 (actions, biến)  │
                  ▼
 Profile ───────► Job ─────────► Task #1 ─► kết quả, log, ảnh chụp
 (đăng nhập,      "chạy thế nào"  Task #2 ─► kết quả, log, ảnh chụp
  cookie, proxy)  (song song,     Task #3 ─► ...
                   headed, ...)   (mỗi dòng input là 1 task)</pre>

        <div class="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <el-card shadow="never">
            <template #header>
              <div class="flex items-center gap-2 font-semibold"><el-icon><Document /></el-icon> Script: làm gì trên trang</div>
            </template>
            <p class="mt-0">Là "công thức" đã lưu sẵn để chạy lại nhiều lần, viết bằng JSON:</p>
            <ul class="space-y-1 pl-5">
              <li><code>actions</code>: các bước thao tác, chạy lần lượt (mở trang, bấm, gõ, cuộn, lấy dữ liệu, lặp, rẽ nhánh…)</li>
              <li><code>defaultVars</code>: giá trị mặc định cho các biến <code v-pre>{{tên}}</code> dùng trong actions</li>
              <li><code>emulation</code>: môi trường trình duyệt (ngôn ngữ, múi giờ, kích thước màn hình, proxy)</li>
            </ul>
            <p class="mb-0 text-sm text-gray-500">
              Script <b>không</b> lưu thiết lập lúc chạy (bao nhiêu Chrome, headless hay headed, profile nào). Những thứ đó chọn khi tạo job.
            </p>
          </el-card>

          <el-card shadow="never">
            <template #header>
              <div class="flex items-center gap-2 font-semibold"><el-icon><User /></el-icon> Profile: chạy bằng "người dùng Chrome" nào</div>
            </template>
            <p class="mt-0">
              Là một thư mục dữ liệu Chrome riêng, lưu <b>cookie và phiên đăng nhập</b>. Chỉ cần đăng nhập một lần, các job sau vẫn còn đăng nhập.
            </p>
            <el-table :data="[
              { k: 'Trình duyệt', a: 'Mỗi task một Chrome mới, sạch trơn', b: 'Mở lại đúng thư mục dữ liệu cũ' },
              { k: 'Đăng nhập', a: 'Mất sau khi chạy xong', b: 'Giữ nguyên giữa các lần chạy' },
              { k: 'Song song', a: 'Nhiều task cùng lúc', b: 'Mỗi lúc chỉ 1 task' },
              { k: 'Phù hợp', a: 'Trang công khai, chạy số lượng lớn', b: 'Trang cần đăng nhập (Facebook…)' },
            ]" size="small" border>
              <el-table-column prop="k" label="" width="100" />
              <el-table-column prop="a" label="Không dùng profile" />
              <el-table-column prop="b" label="Dùng profile" />
            </el-table>
            <p class="mb-0 text-sm text-gray-500">Mỗi profile có thể gắn proxy và emulation riêng, ví dụ mỗi tài khoản một profile.</p>
          </el-card>

          <el-card shadow="never">
            <template #header>
              <div class="flex items-center gap-2 font-semibold"><el-icon><List /></el-icon> Job: một lần bấm Start</div>
            </template>
            <p class="mt-0">Chạy <b>một script</b> cho <b>một danh sách đầu vào</b>, kèm các thiết lập chạy:</p>
            <ul class="space-y-1 pl-5">
              <li><b>Inputs</b>: mỗi dòng CSV/JSON tạo ra một task; để trống thì job có 1 task</li>
              <li><b>Concurrency</b>: số Chrome chạy song song</li>
              <li><b>Headless / headed</b>: ẩn hay hiện cửa sổ Chrome</li>
              <li><b>Profile</b>: dùng phiên đăng nhập đã lưu (các task sẽ chạy lần lượt)</li>
              <li><b>Retries</b>, <b>Step timeout</b></li>
            </ul>
            <p class="mb-0 text-sm text-gray-500">Job lưu bản sao script lúc tạo, nên sửa script sau đó không ảnh hưởng job đã chạy.</p>
          </el-card>

          <el-card shadow="never">
            <template #header>
              <div class="flex items-center gap-2 font-semibold"><el-icon><Tickets /></el-icon> Task: một lần chạy cho một đầu vào</div>
            </template>
            <p class="mt-0">
              Mỗi task có Chrome riêng, biến riêng (từ một dòng Inputs), log riêng và <b>kết quả</b> riêng. Trang task cho xem live màn hình,
              log từng bước, Result, Variables và Artifacts (ảnh chụp, file).
            </p>
            <pre class="overflow-auto rounded bg-gray-50 p-3 text-xs">
Inputs:
  name,url
  Nhóm A,https://…/groups/A   →  Task #1
  Nhóm B,https://…/groups/B   →  Task #2</pre>
          </el-card>
        </div>

        <h3 class="mt-8">Biến đến từ đâu</h3>
        <p>
          Chuỗi trong action có thể chứa biến <code v-pre>{{url}}</code>, <code v-pre>{{user.name}}</code>, <code v-pre>{{list.length}}</code>.
          Nếu trùng tên, nguồn sau đè nguồn trước:
        </p>
        <el-steps :active="4" finish-status="success" simple class="!mb-2">
          <el-step title="defaultVars của script" />
          <el-step title="Shared variables của job" />
          <el-step title="Dòng Inputs của task" />
          <el-step title="Biến tạo lúc chạy" />
        </el-steps>
        <p class="text-sm text-gray-500">
          Biến tạo bởi <code>extract</code>, <code>evaluate</code>, <code>getCookies</code>, <code>download</code>, <code>captureResponses</code>
          được lưu vào <b>kết quả</b> của task.
        </p>

        <h3 class="mt-8">Trạng thái</h3>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <el-table :data="[
            { s: 'queued', d: 'Đang chờ tới lượt (giới hạn song song, hoặc profile đang bận)' },
            { s: 'running', d: 'Đang chạy' },
            { s: 'paused', d: 'Chờ bạn: gặp action pause hoặc bạn bấm Pause. Bấm Resume để chạy tiếp' },
            { s: 'done', d: 'Chạy xong' },
            { s: 'failed', d: 'Lỗi: xem bước lỗi, thông báo lỗi và ảnh chụp lúc lỗi' },
            { s: 'cancelled', d: 'Bị huỷ' },
          ]" size="small" border>
            <el-table-column label="Task" width="110">
              <template #default="{ row }"><StatusTag :status="row.s" /></template>
            </el-table-column>
            <el-table-column prop="d" label="Ý nghĩa" />
          </el-table>
          <el-table :data="[
            { s: 'running', d: 'Còn task chưa xong, kể cả task đang paused chờ bạn' },
            { s: 'done', d: 'Mọi task thành công' },
            { s: 'failed', d: 'Có task lỗi. Bấm Retry failed để chạy lại riêng các task lỗi' },
            { s: 'cancelled', d: 'Đã huỷ job' },
          ]" size="small" border>
            <el-table-column label="Job" width="110">
              <template #default="{ row }"><StatusTag :status="row.s" /></template>
            </el-table-column>
            <el-table-column prop="d" label="Ý nghĩa" />
          </el-table>
        </div>

        <h3 class="mt-8">Dữ liệu được lưu ở đâu</h3>
        <el-table :data="[
          { d: 'Script', w: 'MongoDB: scripts' },
          { d: 'Profile', w: 'MongoDB: profiles (phiên mã hoá nếu chế độ database) + thư mục %LOCALAPPDATA%\\browser-automation\\profiles\\<id>' },
          { d: 'Job', w: 'MongoDB: jobs' },
          { d: 'Task và kết quả (result)', w: 'MongoDB: tasks' },
          { d: 'Log từng bước', w: 'MongoDB: task_logs (tự xoá sau 30 ngày)' },
          { d: 'Ảnh chụp, PDF, file tải về', w: 'backend/storage/<jobId>/<taskId>/' },
        ]" size="small" border class="max-w-3xl">
          <el-table-column prop="d" label="Dữ liệu" width="240" />
          <el-table-column prop="w" label="Nơi lưu" />
        </el-table>
        <p class="text-sm text-gray-500">
          Xoá một job thì task, log và file của job đó bị xoá theo; script và profile không bị ảnh hưởng.
        </p>
      </el-tab-pane>

      <!-- ============================== HƯỚNG DẪN ============================== -->
      <el-tab-pane label="Hướng dẫn sử dụng" name="howto">
        <el-alert type="info" :closable="false" show-icon class="!mb-6">
          Cách nhanh nhất: <b>Luồng → Tạo luồng mới</b> đi qua đủ các bước. Làm tay thì theo thứ tự: <b>1. Tạo script</b> → <b>2. Tạo profile</b> (chỉ khi trang cần đăng nhập) → <b>3. Tạo job</b> →
          <b>4. Theo dõi task và lấy kết quả</b>.
        </el-alert>

        <!-- Sources -->
        <section class="mb-10">
          <h2 class="mt-0">Cách nhanh nhất để lấy dữ liệu: luồng kéo từ nguồn</h2>
          <p>
            Không cần viết script. Vào <NuxtLink to="/flows/new">Tạo luồng mới</NuxtLink>, chọn <b>📥 Kéo dữ liệu từ nguồn có sẵn</b>, rồi thêm nguồn:
          </p>
          <ul class="space-y-1 pl-5">
            <li><b>Website khác</b>: nhập link. Không nhập từ khoá thì lấy danh sách (sản phẩm, bài viết…) ngay tại link; có từ khoá thì tool gõ vào ô tìm kiếm của trang rồi lấy kết quả.</li>
            <li><b>Facebook group</b>: nhập link group, cần profile đã đăng nhập Facebook.</li>
            <li><b>Google, YouTube, TikTok, Threads, Shopee</b>: nhập từ khoá. Shopee cần đăng nhập; Google / TikTok hay hỏi captcha, khi đó task tạm dừng, bạn bấm <b>Take control</b> để giải rồi <b>Resume</b>.</li>
          </ul>
          <p>
            Mỗi nguồn nhập được nhiều link / từ khoá (mỗi dòng một mục, mỗi mục một task), mặc định lấy 50 mục; bật <b>Vào từng kết quả lấy chi tiết</b> nếu cần mô tả / nội dung đầy đủ.
            Bấm <b>▶ Chạy thử</b> để thử nhanh với 5 mục. Mỗi lần chạy luồng tạo một job cho mỗi nguồn; dữ liệu mỗi nguồn là một bảng trong trang <NuxtLink to="/data">Dữ liệu</NuxtLink>.
          </p>
        </section>

        <!-- Flows -->
        <section class="mb-10">
          <h2 class="mt-0">Cách dễ theo dõi nhất: tạo một Luồng</h2>
          <p>
            Mỗi việc mới (ví dụ "lấy bài mới trong nhóm X", "theo dõi giá sản phẩm Y") nên tạo thành một <b>Luồng</b>.
            Luồng gom profile + script + cách chạy; lần sau chỉ cần bấm <b>▶ Chạy</b>, và mọi lần chạy cùng dữ liệu được xem ở một chỗ.
          </p>
          <ol class="space-y-1 pl-5">
            <li>Vào <NuxtLink to="/flows">Luồng</NuxtLink> → <b>+ Tạo luồng mới</b>, rồi làm lần lượt 5 bước:</li>
            <li><b>Mục tiêu</b>: đặt tên, chọn trang có cần đăng nhập không.</li>
            <li><b>Profile</b> (nếu cần đăng nhập): chọn profile có sẵn hoặc tạo mới, bấm <b>Mở Chrome để đăng nhập</b>, đăng nhập rồi <b>Resume</b> ngay trong trang.</li>
            <li><b>Script</b>: chọn script có sẵn, tự viết, hoặc <b>Tạo bằng AI</b>; bấm <b>Chạy thử 1 lần</b> để kiểm tra.</li>
            <li><b>Job &amp; task</b>: dán danh sách đầu vào (mỗi dòng 1 task; nút <b>Tạo mẫu Inputs</b> điền sẵn các cột script cần), chọn số chạy song song.</li>
            <li><b>Xác nhận</b>: <b>Lưu luồng</b> hoặc <b>Lưu &amp; chạy ngay</b>.</li>
          </ol>
          <p>
            Trang chi tiết luồng hiện 4 bước, lịch sử các lần chạy, và link tới dữ liệu đã lấy.
            Dữ liệu của mọi task chạy xong được tự lưu vào trang <NuxtLink to="/data">Dữ liệu</NuxtLink>: xem dạng bảng, tìm kiếm,
            tải CSV (mở được bằng Excel) hoặc JSON. Mục trùng (cùng url hoặc id) qua nhiều lần chạy được gộp lại, và dữ liệu vẫn còn khi xoá job.
          </p>
        </section>

        <!-- 0. AI -->
        <section class="mb-10">
          <h2 class="mt-0">Cách nhanh: Tạo bằng AI</h2>
          <p>
            Các trang <b>Script</b>, <b>Profiles</b> (nút <b>✨ Tạo bằng AI</b>) và <b>New job</b> có khung <b>Tạo bằng AI</b>.
            Bạn mô tả yêu cầu bằng chữ, AI viết hướng dẫn ngay trong trang và đề xuất cách điền form.
          </p>
          <ol class="space-y-2 pl-5">
            <li>
              Lần đầu: vào <NuxtLink to="/settings">Cài đặt → AI</NuxtLink>, nhập <b>token</b> (API key Anthropic, hoặc token của gateway),
              <b>model</b> (mặc định <code>claude-opus-5-5</code>), và <b>Base URL</b> nếu dùng gateway. Bấm <b>Kiểm tra kết nối</b> rồi <b>Lưu</b>.
              Token được mã hoá khi lưu và không bao giờ hiện lại đầy đủ.
            </li>
            <li>
              Mở khung <b>Tạo bằng AI</b>, gõ yêu cầu, ví dụ:
              <i>"Mở https://quotes.toscrape.com, lấy nội dung, tác giả, tag của mọi câu trích dẫn, đi qua tất cả các trang"</i>.
            </li>
            <li>
              Nên tick <b>Đọc trang trước khi viết</b> (trang Script / New job): AI được xem cấu trúc và ảnh chụp trang thật nên chọn selector chính xác.
              Với trang cần đăng nhập, chọn thêm profile đã đăng nhập.
            </li>
            <li>
              Đọc hướng dẫn AI viết ra, xem phần <b>Sẽ điền vào form</b> (đã được kiểm tra hợp lệ), rồi bấm <b>Accept: điền vào form</b>.
              Chưa ưng thì gõ yêu cầu chỉnh (ví dụ "cuộn 30 lần", "thêm chụp ảnh") để AI sửa tiếp.
            </li>
            <li><b>Accept chỉ điền vào form</b>: bạn vẫn tự kiểm tra rồi bấm Save / Start. AI không tự lưu hay tự chạy gì.</li>
            <li>
              Task bị lỗi: trên trang task bấm <b>✨ Nhờ AI sửa</b>. AI xem bước lỗi, log và ảnh chụp lúc lỗi, giải thích nguyên nhân và đề xuất bản sửa;
              Accept rồi bấm <b>Lưu &amp; chạy lại task lỗi</b>.
            </li>
          </ol>
          <p class="text-sm text-gray-500">Các phần dưới đây hướng dẫn làm bằng tay, đồng thời giúp bạn hiểu và kiểm tra những gì AI đề xuất.</p>
        </section>

        <!-- 1. Script -->
        <section class="mb-10">
          <h2 class="mt-0">1. Tạo script</h2>
          <ol class="space-y-2 pl-5">
            <li>
              Mở trang cần chạy bằng Chrome, chuột phải vào phần tử, chọn <b>Inspect</b> để tìm selector (<code>#id</code>, <code>.class</code>,
              <code>[name=…]</code>…). Thử trong tab Console:
              <code>document.querySelectorAll('.quote').length</code>.
              Hoặc chạy <code>npx playwright codegen --channel chrome &lt;url&gt;</code> để thao tác và xem selector được gợi ý.
            </li>
            <li>Vào <b>Scripts → New script</b>, đặt tên.</li>
            <li>
              Ở ô <b>Actions</b>, viết danh sách bước. Bấm <kbd>Ctrl</kbd>+<kbd>Space</kbd> để xem gợi ý action và tham số; chỗ sai bị gạch đỏ.
              Bắt đầu bằng bản đơn giản:
              <GuideCode :code="SIMPLE" title="Actions" />
            </li>
            <li>Ô <b>Default variables</b>: giá trị mặc định cho biến, ví dụ <code v-pre>{ "url": "https://example.com" }</code>.</li>
            <li>
              Bấm <b>Save &amp; test run (headed)</b> để chạy thử: Chrome mở ra, xem log và <b>Result</b>. Sai thì sửa selector rồi chạy lại.
            </li>
            <li>
              Khi chạy đúng, thêm dần: lấy nhiều trường bằng <code>extract</code> + <code>fields</code>, lặp nhiều trang bằng <code>repeat</code>/<code>forEach</code>,
              đổi giá trị cố định thành biến <code v-pre>{{…}}</code>.
            </li>
          </ol>

          <el-card shadow="never" class="mt-4">
            <template #header>
              <div class="flex items-center justify-between">
                <span class="font-semibold">Ví dụ hoàn chỉnh: lấy câu trích dẫn qua nhiều trang (đã chạy thử)</span>
                <el-button type="primary" size="small" @click="useTemplate">Dùng mẫu này</el-button>
              </div>
            </template>
            <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div class="xl:col-span-2"><GuideCode :code="quotesActions" title="Actions" /></div>
              <div>
                <GuideCode :code="quotesVars" title="Default variables" />
                <p class="text-sm text-gray-600">Ý nghĩa từng bước:</p>
                <ol class="space-y-1 pl-5 text-sm text-gray-600">
                  <li>Mở trang theo tag (biến <code>tag</code>)</li>
                  <li>Tạo danh sách rỗng <code>all</code></li>
                  <li>Lặp tối đa <code>maxPages</code> lần: lấy các câu ở trang hiện tại, gộp vào <code>all</code>, ghi log; hết nút Next thì <code>break</code>, còn thì bấm Next</li>
                </ol>
                <p class="text-sm text-gray-600">Kết quả mỗi phần tử trong <code>all</code>:</p>
                <GuideCode :code="RESULT_SAMPLE" title="Result" />
              </div>
            </div>
          </el-card>
          <p class="text-sm text-gray-500">
            Toàn bộ action và tham số xem ở tab <el-button link type="primary" @click="tab = 'actions'">Tra cứu action</el-button>.
          </p>
        </section>

        <!-- 2. Profile -->
        <section class="mb-10">
          <h2>2. Tạo profile và đăng nhập (trang cần đăng nhập)</h2>
          <ol class="space-y-2 pl-5">
            <li>Vào <b>Profiles → New profile</b>.</li>
            <li>
              Điền <b>Name</b> (ví dụ <code>facebook</code>). Không bắt buộc: <b>Proxy</b>; <b>Emulation</b>, ví dụ
              <code>{ "locale": "vi-VN", "timezoneId": "Asia/Ho_Chi_Minh" }</code>. Bấm <b>Save</b>.
            </li>
            <li>Ở dòng profile vừa tạo, bấm <b>Open to log in</b>, nhập trang đăng nhập rồi bấm <b>Open Chrome</b>.</li>
            <li>Một cửa sổ Chrome mở ra: <b>đăng nhập bằng tay</b> (kể cả mã 2FA, captcha).</li>
            <li>
              Quay lại tool, trên thẻ task (trang job) hoặc trang task, bấm <b>Resume</b>. Chrome đóng lại và phiên đăng nhập được lưu vào profile.
            </li>
          </ol>
          <el-alert type="warning" :closable="false" show-icon class="!mt-3">
            Khi job đăng nhập chưa được Resume, profile vẫn đang được dùng (<b>in use</b>) và không chọn được cho job khác.
            Nên dùng tài khoản phụ cho trang có thể khoá tài khoản khi chạy tự động.
          </el-alert>
        </section>

        <!-- 3. Job -->
        <section class="mb-10">
          <h2>3. Tạo job (chạy script)</h2>
          <p>
            Vào <b>New job</b>, hoặc bấm <b>Run</b> ở trang Scripts. Mỗi job sinh ra một hoặc nhiều task.
          </p>
          <el-table :data="[
            { f: 'What to run', d: 'Saved script: chọn script đã lưu. Inline actions: dán thẳng danh sách action để chạy nhanh, không cần lưu' },
            { f: 'Inputs', d: 'Để trống: 1 task dùng giá trị mặc định của script. Có dữ liệu: mỗi dòng là 1 task, mỗi cột là 1 biến (CSV có dòng tiêu đề, hoặc JSON)' },
            { f: 'Shared variables', d: 'Biến dùng chung cho mọi task (JSON). Thường để trống' },
            { f: 'Job name', d: 'Để trống thì lấy tên script' },
            { f: 'Concurrency', d: 'Số Chrome chạy song song (không áp dụng khi dùng profile)' },
            { f: 'Show Chrome windows', d: 'headed: hiện cửa sổ Chrome, nên dùng khi chạy thử; headless: chạy ẩn' },
            { f: 'Profile', d: 'Chọn khi trang cần đăng nhập; các task chạy lần lượt' },
            { f: 'Retries', d: 'Số lần tự chạy lại một task bị lỗi' },
            { f: 'Step timeout', d: 'Thời gian chờ tối đa mỗi bước (giây)' },
          ]" size="small" border>
            <el-table-column prop="f" label="Ô" width="180" />
            <el-table-column prop="d" label="Điền gì" />
          </el-table>

          <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <el-card shadow="never" header="Không dùng profile: chạy nhiều đầu vào song song">
              <ol class="mt-0 space-y-1 pl-5">
                <li>Chọn script (ví dụ "Lấy câu trích dẫn").</li>
                <li>Dán Inputs, mỗi dòng là một task:</li>
              </ol>
              <GuideCode :code="INPUTS_CSV" title="Inputs (CSV)" />
              <ol start="3" class="space-y-1 pl-5">
                <li>Concurrency = 3, headless.</li>
                <li>Bấm <b>Start 3 task(s)</b>.</li>
              </ol>
            </el-card>
            <el-card shadow="never" header="Dùng profile: trang cần đăng nhập (ví dụ Facebook)">
              <ol class="mt-0 space-y-1 pl-5">
                <li>Chọn script "Facebook group – lấy bài đăng".</li>
                <li>Inputs: để trống để chạy nhóm mặc định, hoặc dán nhiều nhóm:</li>
              </ol>
              <GuideCode :code="FB_INPUTS" title="Inputs (CSV)" />
              <ol start="3" class="space-y-1 pl-5">
                <li><b>Profile</b>: chọn <code>facebook</code> (đã đăng nhập ở bước 2).</li>
                <li>Gạt sang <b>headed</b> để xem chạy, rồi bấm <b>Start</b>.</li>
              </ol>
            </el-card>
          </div>
        </section>

        <!-- 4. Task -->
        <section>
          <h2>4. Theo dõi task và lấy kết quả</h2>
          <ol class="space-y-2 pl-5">
            <li>
              Sau khi bấm Start, trang <b>job</b> hiện lưới live của mọi task, kèm tiến độ (đang chờ, đang chạy, xong, lỗi).
              Lọc theo trạng thái bằng các nút All / Running / Failed…
            </li>
            <li>
              Bấm vào một thẻ task để mở trang <b>task</b>: màn hình live lớn, <b>Steps</b> (log từng bước), <b>Result</b> (dữ liệu lấy được),
              <b>Variables</b>, <b>Artifacts</b> (ảnh chụp, file, có nút tải về).
            </li>
            <li>
              <b>Cần thao tác tay</b> (captcha, OTP): bấm <b>Pause</b> (task dừng trước bước kế tiếp), hoặc đặt sẵn action <code>pause</code> trong script.
              Bật <b>Take control</b> để click và gõ phím trực tiếp trên màn hình live, rồi bấm <b>Resume</b>.
              <GuideCode :code="LOGIN_PAUSE" title="Tự dừng khi gặp captcha" />
            </li>
            <li>
              <b>Task lỗi</b>: khung đỏ cho biết bước lỗi (ví dụ <code>3.actions.2</code> là bước 2 bên trong bước 3) kèm ảnh chụp lúc lỗi.
              Sửa script rồi bấm <b>Retry failed</b> trên trang job để chạy lại riêng các task lỗi.
            </li>
            <li>
              <b>Lấy kết quả</b>: xem khung Result của từng task, hoặc bấm <b>Export results</b> trên trang job để tải file JSON.
            </li>
          </ol>
        </section>
      </el-tab-pane>

      <!-- ============================== TRA CỨU ============================== -->
      <el-tab-pane label="Tra cứu action" name="actions">
        <p class="text-gray-600">
          Danh sách đọc trực tiếp từ schema của backend, nên luôn khớp với phiên bản đang chạy. Tham số <b>in đậm</b> là bắt buộc.
          Mọi action đều nhận thêm <code>timeout</code> (ms), <code>optional</code> (lỗi thì bỏ qua) và <code>label</code> (tên trong log).
          Tham số kiểu số nhận được biến dạng <code v-pre>"{{tên}}"</code>.
        </p>
        <el-input v-model="filter" placeholder="Tìm action, ví dụ: click, scroll, cookie…" clearable class="!mb-4 !w-80" />

        <div v-for="g in groupedActions" :key="g.group" class="mb-6">
          <h3 class="mb-2">{{ g.group }}</h3>
          <el-table :data="g.rows" size="small" border>
            <el-table-column label="Action" width="160">
              <template #default="{ row }"><code class="font-semibold text-blue-700">{{ row.type }}</code></template>
            </el-table-column>
            <el-table-column prop="description" label="Mô tả" min-width="220" />
            <el-table-column label="Tham số" min-width="420">
              <template #default="{ row }">
                <span v-if="!row.params.length" class="text-gray-400">không có</span>
                <div v-for="p in row.params" :key="p.name" class="leading-6">
                  <code :class="p.required ? 'font-bold' : ''">{{ p.name }}</code>
                  <span class="ml-1 text-xs text-gray-500">{{ p.type }}</span>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <h3>Điều kiện (dùng trong <code>if.condition</code> và <code>repeat.while</code>)</h3>
        <el-table :data="[
          { c: '{ &quot;exists&quot;: &quot;.selector&quot; }', d: 'Có phần tử khớp' },
          { c: '{ &quot;visible&quot;: &quot;.selector&quot; }', d: 'Phần tử đang hiển thị' },
          { c: '{ &quot;urlIncludes&quot;: &quot;checkout&quot; }', d: 'URL hiện tại chứa chuỗi' },
          { c: '{ &quot;textIncludes&quot;: { &quot;selector&quot;: &quot;.msg&quot;, &quot;text&quot;: &quot;OK&quot; } }', d: 'Chữ của phần tử (hoặc cả trang) chứa text' },
          { c: '{ &quot;var&quot;: &quot;items&quot; }', d: 'Biến có giá trị (mảng thì khác rỗng)' },
          { c: '{ &quot;var&quot;: &quot;status&quot;, &quot;equals&quot;: &quot;ok&quot; }', d: 'Biến bằng giá trị' },
          { c: '{ &quot;js&quot;: &quot;vars.count > 10&quot; }', d: 'Biểu thức JavaScript (chạy trong trang, có vars)' },
          { c: '{ &quot;not&quot;: {…} } · { &quot;all&quot;: […] } · { &quot;any&quot;: […] }', d: 'Phủ định, và, hoặc' },
        ]" size="small" border class="max-w-4xl">
          <el-table-column label="Điều kiện" min-width="320">
            <template #default="{ row }"><code v-html="row.c" /></template>
          </el-table-column>
          <el-table-column prop="d" label="Đúng khi" />
        </el-table>

        <h3 class="mt-6">Kiểu lấy dữ liệu của <code>extract.get</code></h3>
        <el-table :data="[
          { g: 'text (mặc định)', d: 'Chữ hiển thị' },
          { g: 'html / outerHtml', d: 'HTML bên trong / gồm cả thẻ' },
          { g: 'value', d: 'Giá trị ô nhập' },
          { g: 'attr:<tên>', d: 'Thuộc tính như trong HTML, ví dụ attr:href, attr:data-id' },
          { g: 'prop:<tên>', d: 'Thuộc tính DOM, ví dụ prop:href (URL đầy đủ), prop:src' },
        ]" size="small" border class="max-w-3xl">
          <el-table-column prop="g" label="get" width="200" />
          <el-table-column prop="d" label="Lấy gì" />
        </el-table>

        <p class="mt-6 text-sm text-gray-500">
          Bản đầy đủ có giải thích từng tham số và các mẫu thường dùng: file <code>docs/script.md</code> trong thư mục dự án.
        </p>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.guide :deep(h2) {
  font-size: 1.15rem;
  font-weight: 600;
}
.guide :deep(h3) {
  font-size: 1rem;
  font-weight: 600;
}
.guide :deep(code) {
  background: var(--el-fill-color-light);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 0.85em;
}
.guide :deep(pre code) {
  background: none;
  padding: 0;
}
.guide :deep(kbd) {
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 0.8em;
}
</style>
