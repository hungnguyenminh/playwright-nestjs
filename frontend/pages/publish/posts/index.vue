<script setup lang="ts">
import type { Paged, Platform, PlatformInfo, Post, PostStatus } from '~/types/api';

/** Post library: filter, bulk approve (draft → ready), open the editor. */
const { api, base } = useApi();
const route = useRoute();
const router = useRouter();

const STATUS: Record<PostStatus, { label: string; type: 'warning' | 'success' | 'info' }> = {
  draft: { label: 'Nháp', type: 'warning' },
  ready: { label: 'Sẵn sàng', type: 'success' },
  archived: { label: 'Lưu trữ', type: 'info' },
};
const ICON: Record<Platform, string> = { facebook: '📘', youtube: '▶️', tiktok: '🎵', threads: '🧵' };

const query = reactive({
  status: (route.query.status as string) || '',
  tag: (route.query.tag as string) || '',
  q: (route.query.q as string) || '',
  page: 1,
  limit: 20,
});
const data = ref<Paged<Post>>({ items: [], total: 0, page: 1, limit: 20 });
const loading = ref(false);
const tags = ref<string[]>([]);
const infos = ref<PlatformInfo[]>([]);
const selected = ref<Post[]>([]);

async function load() {
  loading.value = true;
  const q = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== ''));
  data.value = (await tryApi(() => api<Paged<Post>>('/posts', { query: q }))) ?? data.value;
  loading.value = false;
}
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => ({ ...query }),
  (q, old) => {
    router.replace({ query: Object.fromEntries(Object.entries({ status: q.status, tag: q.tag, q: q.q }).filter(([, v]) => v)) });
    clearTimeout(timer);
    timer = setTimeout(load, old && q.q !== old.q ? 300 : 0);
  },
  { immediate: true },
);
onMounted(async () => {
  const [t, i] = await Promise.all([tryApi(() => api<string[]>('/posts/tags')), tryApi(() => api<PlatformInfo[]>('/publish/platforms'))]);
  tags.value = t ?? [];
  infos.value = i ?? [];
});

const formatLabel = (p: Platform, f?: string | null) => infos.value.find((i) => i.platform === p)?.formats.find((x) => x.value === f)?.label ?? f ?? '?';

async function setStatus(status: PostStatus) {
  const res = await tryApi(() =>
    api<{ updated: number; failed: Array<{ title: string; errors: string[] }> }>('/posts/bulk-status', {
      method: 'POST',
      body: { ids: selected.value.map((p) => p._id), status },
    }),
  );
  if (!res) return;
  if (res.failed.length) {
    ElMessageBox.alert(
      res.failed.map((f) => `• ${f.title}: ${f.errors.join('; ')}`).join('\n'),
      `${res.updated} bài đã cập nhật, ${res.failed.length} bài chưa thể "sẵn sàng"`,
      { type: 'warning' },
    );
  } else ElMessage.success(`Đã cập nhật ${res.updated} bài`);
  load();
}
</script>

<template>
  <div class="page">
    <PageHeader title="Đăng bài" subtitle="Kho bài viết dùng cho đăng ngay và lịch đăng.">
      <template #actions>
        <el-button type="primary" @click="navigateTo('/publish/posts/new')">+ Bài viết mới</el-button>
      </template>
    </PageHeader>
    <PublishTabs />

    <div class="flex flex-wrap items-center gap-2">
      <el-radio-group v-model="query.status" size="small">
        <el-radio-button value="">Tất cả</el-radio-button>
        <el-radio-button value="draft">Nháp</el-radio-button>
        <el-radio-button value="ready">Sẵn sàng</el-radio-button>
        <el-radio-button value="archived">Lưu trữ</el-radio-button>
      </el-radio-group>
      <el-select v-model="query.tag" clearable placeholder="Nhãn" size="small" class="!w-40">
        <el-option v-for="t in tags" :key="t" :value="t" :label="t" />
      </el-select>
      <el-input v-model="query.q" clearable placeholder="Tìm theo tên, nội dung…" size="small" class="!w-64" />
      <div v-if="selected.length" class="ml-auto flex items-center gap-2 text-sm">
        <span class="text-slate-500">Đã chọn {{ selected.length }}</span>
        <el-button size="small" type="success" @click="setStatus('ready')">Duyệt → Sẵn sàng</el-button>
        <el-button size="small" @click="setStatus('draft')">Về nháp</el-button>
        <el-button size="small" @click="setStatus('archived')">Lưu trữ</el-button>
      </div>
    </div>

    <el-card shadow="never" :body-class="data.items.length ? '!p-0' : ''">
      <el-empty v-if="!loading && !data.items.length" description="Chưa có bài nào">
        <el-button type="primary" @click="navigateTo('/publish/posts/new')">Viết bài đầu tiên</el-button>
      </el-empty>
      <el-table v-else v-loading="loading" :data="data.items" row-key="_id" @selection-change="(rows: Post[]) => (selected = rows)" @row-click="(row: Post) => navigateTo(`/publish/posts/${row._id}`)">
        <el-table-column type="selection" width="44" />
        <el-table-column label="Bài viết" min-width="300">
          <template #default="{ row }">
            <div class="flex items-center gap-3">
              <div class="h-12 w-16 shrink-0 overflow-hidden rounded bg-slate-100">
                <img v-if="row.media[0]?.kind === 'image'" :src="`${base}/media/${row.media[0]._id}/file`" class="h-full w-full object-cover" loading="lazy" />
                <div v-else-if="row.media[0]" class="flex h-full items-center justify-center text-lg">🎬</div>
                <div v-else class="flex h-full items-center justify-center text-xs text-slate-400">chữ</div>
              </div>
              <div class="min-w-0">
                <div class="truncate font-medium">{{ row.title }}</div>
                <div class="truncate text-xs text-slate-500">{{ row.content }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="Nền tảng · dạng" min-width="240">
          <template #default="{ row }">
            <div class="flex flex-wrap gap-1">
              <el-tag v-for="(c, p) in row.checks" :key="p" size="small" :type="c.errors.length ? 'danger' : 'info'" :title="c.errors.join('\n')">
                {{ ICON[p as Platform] }} {{ formatLabel(p as Platform, c.format) }}{{ c.errors.length ? ` · ${c.errors.length} lỗi` : '' }}
              </el-tag>
              <span v-if="!Object.keys(row.checks).length" class="text-xs text-slate-400">chưa chọn</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="Trạng thái" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="STATUS[row.status as PostStatus].type">{{ STATUS[row.status as PostStatus].label }}</el-tag>
            <el-tag v-if="row.origin === 'ai'" size="small" class="ml-1">AI</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Nhãn" min-width="140">
          <template #default="{ row }">
            <span class="text-xs text-slate-500">{{ row.tags.join(', ') }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Đã đăng" width="90" align="center" prop="usedCount" />
        <el-table-column label="Sửa lúc" width="150">
          <template #default="{ row }">{{ fmtDate(row.updatedAt) }}</template>
        </el-table-column>
      </el-table>
      <div v-if="data.total > query.limit" class="flex justify-end p-3">
        <el-pagination v-model:current-page="query.page" :page-size="query.limit" :total="data.total" layout="prev, pager, next" small />
      </div>
    </el-card>
  </div>
</template>
