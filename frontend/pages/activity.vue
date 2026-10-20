<script setup lang="ts">
/** Everything that happened: people's changes, what the app did on its own, what the AI changed. */
interface ActivityItem {
  _id: string;
  at: string;
  actor: 'user' | 'system' | 'ai';
  level: 'info' | 'warn' | 'error';
  category: string;
  action: string;
  summary: string;
  target?: { type: string; id?: string; name?: string };
  details?: Record<string, unknown>;
}

const { api } = useApi();
const route = useRoute();
const router = useRouter();

const ACTORS = { user: { label: 'Người dùng', icon: '👤' }, system: { label: 'Hệ thống', icon: '⚙️' }, ai: { label: 'AI', icon: '✨' } } as const;
const CATEGORY_LABEL: Record<string, string> = {
  flow: 'Luồng',
  crawl: 'Kéo dữ liệu',
  pipeline: 'Kéo → Đăng',
  publish: 'Đăng bài',
  post: 'Bài viết',
  campaign: 'Lịch đăng',
  selector: 'Bộ đăng',
  profile: 'Profile',
  script: 'Script',
  job: 'Job / task',
  data: 'Dữ liệu',
  settings: 'Cài đặt',
  ai: 'AI',
  system: 'Hệ thống',
};

const filter = reactive({
  actor: ((route.query.actor as string) || '').split(',').filter(Boolean),
  category: ((route.query.category as string) || '').split(',').filter(Boolean),
  level: (route.query.level as string) || '',
  q: (route.query.q as string) || '',
  range: [] as string[],
  page: 1,
  limit: 50,
});
const data = ref<{ items: ActivityItem[]; total: number }>({ items: [], total: 0 });
const categories = ref<string[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  const query: Record<string, unknown> = { page: filter.page, limit: filter.limit };
  if (filter.actor.length) query.actor = filter.actor.join(',');
  if (filter.category.length) query.category = filter.category.join(',');
  if (filter.level) query.level = filter.level;
  if (filter.q.trim()) query.q = filter.q.trim();
  if (filter.range?.length === 2) Object.assign(query, { from: filter.range[0], to: filter.range[1] });
  data.value = (await tryApi(() => api<typeof data.value>('/activity', { query }))) ?? data.value;
  loading.value = false;
}
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => [filter.actor.join(), filter.category.join(), filter.level, filter.q, filter.range?.join()],
  () => {
    filter.page = 1;
    router.replace({ query: { ...(filter.actor.length ? { actor: filter.actor.join(',') } : {}), ...(filter.category.length ? { category: filter.category.join(',') } : {}), ...(filter.level ? { level: filter.level } : {}), ...(filter.q ? { q: filter.q } : {}) } });
    clearTimeout(timer);
    timer = setTimeout(load, 300);
  },
);
watch(() => [filter.page, filter.limit], load);
onMounted(async () => {
  categories.value = (await tryApi(() => api<string[]>('/activity/categories'))) ?? [];
  load();
});
// New entries while the page is open.
useLiveRoom('subscribe:jobs', {});
let live: ReturnType<typeof setTimeout> | undefined;
const refresh = () => {
  if (filter.page !== 1) return;
  clearTimeout(live);
  live = setTimeout(load, 1500);
};
useLiveEvent('job:update', refresh);
useLiveEvent('publication:update', refresh);

function toggleActor(a: string) {
  filter.actor = filter.actor.includes(a) ? filter.actor.filter((x) => x !== a) : [...filter.actor, a];
}
const LEVEL_TAG = { info: 'info', warn: 'warning', error: 'danger' } as const;
const targetLink = (t?: ActivityItem['target']) => {
  if (!t?.id) return null;
  const map: Record<string, string> = { flow: `/flows/${t.id}`, job: `/jobs/${t.id}`, task: `/tasks/${t.id}`, post: `/publish/posts/${t.id}`, campaign: `/publish/campaigns/${t.id}`, profile: '/profiles', script: `/scripts/${t.id}`, selector: '/publish/selectors' };
  return map[t.type] ?? null;
};
const DATE_SHORTCUTS = [
  { text: '24 giờ qua', value: () => [new Date(Date.now() - 86_400_000), new Date()] },
  { text: '7 ngày qua', value: () => [new Date(Date.now() - 7 * 86_400_000), new Date()] },
];
</script>

<template>
  <div class="page">
    <PageHeader title="Nhật ký hoạt động" subtitle="Mọi thao tác của người dùng (qua giao diện / API), mọi việc hệ thống tự làm (chạy, lịch đăng, tự chạy) và mọi thay đổi do AI thực hiện." />

    <div class="flex flex-wrap items-center gap-2">
      <button v-for="(a, key) in ACTORS" :key="key" type="button" class="chip" :class="{ on: filter.actor.includes(key) }" @click="toggleActor(key)">{{ a.icon }} {{ a.label }}</button>
      <el-select v-model="filter.category" multiple collapse-tags clearable placeholder="Mọi mục" size="small" class="!w-56">
        <el-option v-for="c in categories" :key="c" :value="c" :label="CATEGORY_LABEL[c] ?? c" />
      </el-select>
      <el-select v-model="filter.level" clearable placeholder="Mọi mức" size="small" class="!w-32">
        <el-option value="warn,error" label="Cảnh báo + lỗi" />
        <el-option value="error" label="Chỉ lỗi" />
      </el-select>
      <el-date-picker v-model="filter.range" type="datetimerange" size="small" value-format="YYYY-MM-DDTHH:mm:ss.SSSZ" :shortcuts="DATE_SHORTCUTS" start-placeholder="Từ" end-placeholder="Đến" class="!w-80" />
      <el-input v-model="filter.q" clearable size="small" placeholder="Tìm (tên, id, nội dung…)" class="!w-60" />
    </div>

    <el-card shadow="never" body-class="!p-0">
      <el-table v-loading="loading" :data="data.items" size="small" row-key="_id">
        <el-table-column type="expand">
          <template #default="{ row }">
            <pre class="m-0 max-h-80 overflow-auto bg-slate-50 p-3 text-xs">{{ JSON.stringify({ action: row.action, target: row.target, ...row.details }, null, 2) }}</pre>
          </template>
        </el-table-column>
        <el-table-column label="Lúc" width="150">
          <template #default="{ row }">{{ fmtDate(row.at) }}<span class="text-slate-400">:{{ new Date(row.at).getSeconds().toString().padStart(2, '0') }}</span></template>
        </el-table-column>
        <el-table-column label="Ai" width="120">
          <template #default="{ row }">{{ ACTORS[row.actor as keyof typeof ACTORS].icon }} {{ ACTORS[row.actor as keyof typeof ACTORS].label }}</template>
        </el-table-column>
        <el-table-column label="Mục" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="LEVEL_TAG[row.level as keyof typeof LEVEL_TAG]" disable-transitions>{{ CATEGORY_LABEL[row.category] ?? row.category }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Hoạt động" min-width="420">
          <template #default="{ row }">
            <span :class="row.level === 'error' ? 'text-red-600' : row.level === 'warn' ? 'text-amber-700' : ''">{{ row.summary }}</span>
            <NuxtLink v-if="targetLink(row.target)" :to="targetLink(row.target)!" class="ml-2 text-xs">mở →</NuxtLink>
          </template>
        </el-table-column>
      </el-table>
      <div class="flex justify-end p-3">
        <el-pagination v-model:current-page="filter.page" v-model:page-size="filter.limit" :total="data.total" :page-sizes="[50, 100, 200]" layout="total, sizes, prev, pager, next" />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.chip {
  border: 1px solid var(--el-border-color);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 13px;
  background: #fff;
  cursor: pointer;
}
.chip.on {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
</style>
