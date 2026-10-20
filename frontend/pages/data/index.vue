<script setup lang="ts">
import type { DataRecord, DatasetSummary, GenerateSpec, Paged } from '~/types/api';

/** Everything tasks collected, grouped by flow/script and result variable. */
const route = useRoute();
const router = useRouter();
const { api, base } = useApi();

const datasets = ref<DatasetSummary[]>([]);
const selected = computed(() => {
  const scope = route.query.scope as string | undefined;
  const dataset = route.query.dataset as string | undefined;
  return datasets.value.find((d) => d.scope === scope && d.dataset === dataset);
});

const query = reactive({ q: '', page: 1, limit: 50 });
const table = ref<Paged<DataRecord> & { columns: string[] }>({ items: [], total: 0, page: 1, limit: 50, columns: [] });
const loading = ref(false);

const SCOPE_LABEL = { flow: 'Luồng', script: 'Script', job: 'Job' } as const;

/** Datasets grouped under their flow / script. */
const groups = computed(() => {
  const map = new Map<string, { scope: string; scopeName: string; scopeType: DatasetSummary['scopeType']; items: DatasetSummary[] }>();
  for (const d of datasets.value) {
    if (!map.has(d.scope)) map.set(d.scope, { scope: d.scope, scopeName: d.scopeName, scopeType: d.scopeType, items: [] });
    map.get(d.scope)!.items.push(d);
  }
  return [...map.values()];
});

async function loadDatasets() {
  datasets.value = (await tryApi(() => api<DatasetSummary[]>('/data/datasets'))) ?? [];
  // Default to the biggest dataset (usually the list that was scraped).
  const biggest = [...datasets.value].sort((a, b) => b.count - a.count)[0];
  if (!selected.value && biggest) select(biggest);
}

async function loadRecords() {
  if (!selected.value) return;
  loading.value = true;
  const res = await tryApi(() =>
    api<typeof table.value>('/data/records', {
      query: { scope: selected.value!.scope, dataset: selected.value!.dataset, q: query.q || undefined, page: query.page, limit: query.limit },
    }),
  );
  if (res) table.value = res;
  loading.value = false;
}

function select(d: DatasetSummary) {
  query.page = 1;
  query.q = '';
  router.replace({ query: { scope: d.scope, dataset: d.dataset } });
}

watch(() => [route.query.scope, route.query.dataset, selected.value?.count], loadRecords);
watch(() => [query.page, query.limit], loadRecords);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => query.q,
  () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      query.page = 1;
      loadRecords();
    }, 300);
  },
);
onMounted(loadDatasets);

// New data arrives when tasks finish.
useLiveRoom('subscribe:jobs', {});
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
useLiveEvent<{ status?: string }>('job:update', (p) => {
  if (!p.status || !['done', 'failed'].includes(p.status)) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadDatasets, 1000);
});

function exportUrl(format: 'csv' | 'json') {
  const params = new URLSearchParams({ scope: selected.value!.scope, dataset: selected.value!.dataset, format });
  if (query.q) params.set('q', query.q);
  return `${base}/data/export?${params}`;
}

async function removeDataset() {
  const d = selected.value!;
  const ok = await ElMessageBox.confirm(`Xoá toàn bộ ${d.count} dòng "${d.dataset}" của "${d.scopeName}"?`, 'Xoá dữ liệu', {
    type: 'warning',
    confirmButtonText: 'Xoá',
  }).catch(() => false);
  if (!ok) return;
  await tryApi(() => api('/data/records', { method: 'DELETE', query: { scope: d.scope, dataset: d.dataset } }), 'Đã xoá');
  router.replace({ query: {} });
  loadDatasets();
}

// ---- AI posts from selected rows ----------------------------------------------
const picked = ref<DataRecord[]>([]);
const gen = reactive({
  open: false,
  busy: false,
  spec: { mode: 'perRecord', digestSize: 5, prompt: '', length: 'medium', platforms: ['facebook'], maxPostsPerRun: 20, attachImage: true, approval: 'review' } as GenerateSpec,
});
async function generatePosts() {
  if (!gen.spec.platforms.length) return ElMessage.warning('Chọn nền tảng');
  gen.busy = true;
  const tag = `AI · ${selected.value?.scopeName ?? ''}`.slice(0, 60);
  const res = await tryApi(() =>
    api<{ created: Array<{ _id: string }>; skipped: unknown[]; errors: string[] }>('/posts/generate', {
      method: 'POST',
      body: { ...gen.spec, recordIds: picked.value.map((r) => r._id), tags: [tag] },
    }),
  );
  gen.busy = false;
  if (!res) return;
  gen.open = false;
  if (res.errors.length) ElMessage.warning({ message: res.errors.join('; '), duration: 8000 });
  ElMessage.success(`AI đã viết ${res.created.length} bài${res.skipped.length ? `, bỏ qua ${res.skipped.length} dòng đã có bài` : ''}`);
  if (res.created.length) navigateTo({ path: '/publish/posts', query: { tag } });
}

async function removeRow(r: DataRecord) {
  await tryApi(() => api(`/data/records/${r._id}`, { method: 'DELETE' }));
  loadRecords();
  loadDatasets();
}

// ---- cell rendering ------------------------------------------------------------
const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/\S+$/.test(v);
const isImage = (v: unknown): v is string =>
  isUrl(v) && (/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(v) || /scontent|fbcdn|googleusercontent|cloudfront.*\/(img|image)/i.test(v));
const images = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isImage) : isImage(v) ? [v] : []);
const text = (v: unknown) => {
  if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};
const decode = (u: string) => {
  try {
    return decodeURI(u);
  } catch {
    return u;
  }
};
/** Readable link text: no scheme, %-escapes decoded, capped. */
const shortUrl = (u: string) => {
  const s = decode(u).replace(/^https?:\/\/(www\.)?/, '');
  return s.length > 56 ? `${s.slice(0, 55)}…` : s;
};
</script>

<template>
  <div class="page">
    <PageHeader
      title="Kéo dữ liệu"
      subtitle="Kết quả của mọi task chạy xong, theo luồng / script. Mục trùng (cùng url hoặc id) được gộp; dữ liệu vẫn còn khi xoá job."
    />
    <CrawlTabs />

    <el-empty v-if="!datasets.length" description="Chưa có dữ liệu. Chạy một luồng hoặc job, khi task xong kết quả sẽ hiện ở đây." />

    <div v-else class="grid grid-cols-1 gap-4 xl:grid-cols-[280px_1fr]">
      <!-- datasets -->
      <el-card shadow="never" body-class="!p-2">
        <div v-for="g in groups" :key="g.scope" class="mb-3">
          <div class="flex items-center gap-1 px-2 py-1 text-xs text-gray-500">
            <el-tag size="small" :type="g.scopeType === 'flow' ? 'primary' : 'info'" disable-transitions>{{ SCOPE_LABEL[g.scopeType] }}</el-tag>
            <span class="truncate font-medium text-gray-700" :title="g.scopeName">{{ g.scopeName || g.scope }}</span>
          </div>
          <div
            v-for="d in g.items"
            :key="d.dataset"
            class="flex cursor-pointer items-center justify-between rounded px-3 py-1.5 text-sm hover:bg-gray-100"
            :class="selected?.scope === d.scope && selected?.dataset === d.dataset ? 'bg-blue-50 text-blue-700' : ''"
            @click="select(d)"
          >
            <span class="truncate">{{ d.dataset }}</span>
            <span class="text-xs text-gray-400">{{ d.count }}</span>
          </div>
        </div>
      </el-card>

      <!-- table -->
      <el-card v-if="selected" shadow="never">
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span class="font-semibold">{{ selected.dataset }}</span>
              <span class="ml-2 text-sm font-normal text-slate-500">{{ selected.scopeName }} · {{ table.total }} dòng · cập nhật {{ fmtDate(selected.lastSeenAt) }}</span>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <el-input v-model="query.q" placeholder="Tìm trong dữ liệu…" clearable size="small" class="!w-full sm:!w-56" />
              <el-button size="small" tag="a" :href="exportUrl('csv')">Tải CSV (Excel)</el-button>
              <el-button size="small" tag="a" :href="exportUrl('json')">Tải JSON</el-button>
              <el-button size="small" type="primary" :disabled="!picked.length" @click="gen.open = true">
                ✨ Tạo bài bằng AI{{ picked.length ? ` (${picked.length})` : '' }}
              </el-button>
              <el-button size="small" type="danger" plain @click="removeDataset">Xoá bộ dữ liệu</el-button>
            </div>
          </div>
        </template>

        <el-table
          v-loading="loading"
          :data="table.items"
          size="small"
          border
          max-height="640"
          row-key="_id"
          @selection-change="(rows: DataRecord[]) => (picked = rows)"
        >
          <el-table-column type="selection" width="40" reserve-selection />
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="space-y-2 p-2">
                <pre class="m-0 max-h-80 overflow-auto rounded bg-gray-50 p-2 text-xs">{{ JSON.stringify(row.data, null, 2) }}</pre>
                <div class="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                  <span>Task: <NuxtLink :to="`/tasks/${row.taskId}`">{{ row.taskName || row.taskId }}</NuxtLink></span>
                  <span>Lần đầu: {{ fmtDate(row.firstSeenAt) }}</span>
                  <span>Gặp {{ row.seenCount }} lần</span>
                  <el-button link type="danger" size="small" @click="removeRow(row as DataRecord)">Xoá dòng này</el-button>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column v-for="c in table.columns" :key="c" :label="c" min-width="160">
            <template #default="{ row }">
              <div v-if="images(row.data[c]).length" class="flex items-center gap-1">
                <el-image
                  :src="images(row.data[c])[0]"
                  :preview-src-list="images(row.data[c])"
                  fit="cover"
                  class="h-12 w-16 rounded"
                  preview-teleported
                  lazy
                />
                <span v-if="images(row.data[c]).length > 1" class="text-xs text-gray-400">+{{ images(row.data[c]).length - 1 }}</span>
              </div>
              <a v-else-if="isUrl(row.data[c])" :href="row.data[c]" target="_blank" rel="noopener" :title="row.data[c]">{{ shortUrl(row.data[c]) }}</a>
              <span v-else class="line-clamp-3 whitespace-pre-line break-words" :title="text(row.data[c])">{{ text(row.data[c]) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Cập nhật" width="150">
            <template #default="{ row }">
              <span class="text-xs">{{ fmtDate(row.lastSeenAt) }}</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="mt-3 flex justify-end">
          <el-pagination
            v-model:current-page="query.page"
            v-model:page-size="query.limit"
            :total="table.total"
            :page-sizes="[20, 50, 100, 200]"
            layout="total, sizes, prev, pager, next"
            small
          />
        </div>
      </el-card>
    </div>

    <el-dialog v-model="gen.open" :title="`AI viết bài từ ${picked.length} dòng đã chọn`" width="860px">
      <GenerateEditor v-model="gen.spec" />
      <template #footer>
        <el-button @click="gen.open = false">Huỷ</el-button>
        <el-button type="primary" :loading="gen.busy" @click="generatePosts">Viết bài</el-button>
      </template>
    </el-dialog>
  </div>
</template>
