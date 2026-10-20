<script setup lang="ts">
import { Coin, Cpu, List, Monitor, Promotion } from '@element-plus/icons-vue';
import type { DatasetSummary, FlowListItem, Job, Paged, PoolStats, Post, Publication } from '~/types/api';
import { JOB_CATEGORY } from '~/utils/publish';

const { api } = useApi();
const pool = ref<PoolStats>();
const flows = ref<FlowListItem[]>([]);
const datasets = ref<DatasetSummary[]>([]);
const upcoming = ref<Publication[]>([]);
const drafts = ref(0);

const active = useJobsList(() => ({ status: 'queued,running', limit: 50 }));
const recent = useJobsList(() => ({ limit: 8 }));

async function loadStats() {
  pool.value = (await api<{ pool: PoolStats }>('/system').catch(() => undefined))?.pool;
}
async function loadSide() {
  const [f, d, u, p] = await Promise.all([
    api<FlowListItem[]>('/flows').catch(() => []),
    api<DatasetSummary[]>('/data/datasets').catch(() => []),
    api<{ items: Publication[] }>('/publish/upcoming', { query: { from: new Date().toISOString() } }).catch(() => ({ items: [] })),
    api<Paged<Post>>('/posts', { query: { status: 'draft', limit: 1 } }).catch(() => undefined),
  ]);
  flows.value = f.slice(0, 6);
  datasets.value = d;
  upcoming.value = u.items.filter((x) => ['scheduled', 'waiting', 'running'].includes(x.status));
  drafts.value = p?.total ?? 0;
}
loadStats();
loadSide();
const timer = setInterval(loadStats, 3000);
onBeforeUnmount(() => clearInterval(timer));
useLiveEvent('publication:update', () => setTimeout(loadSide, 800));
useLiveEvent<{ status?: string }>('job:update', (p) => {
  if (p.status === 'done' || p.status === 'failed') setTimeout(loadSide, 1000);
});

const records = computed(() => datasets.value.reduce((n, d) => n + d.count, 0));
const usage = computed(() => (pool.value ? Math.round((pool.value.activeContexts / pool.value.maxConcurrency) * 100) : 0));

const tiles = computed(() => [
  {
    label: 'Chrome đang chạy',
    value: pool.value ? `${pool.value.activeContexts}/${pool.value.maxConcurrency}` : '—',
    hint: pool.value ? `${pool.value.browsers} tiến trình · ${pool.value.queued} đang chờ slot` : '',
    icon: Monitor,
    tone: 'bg-indigo-50 text-indigo-600',
  },
  { label: 'Job đang chạy', value: active.data.value.total, hint: 'queued + running', icon: Cpu, tone: 'bg-sky-50 text-sky-600' },
  {
    label: 'Sắp đăng (24 giờ)',
    value: upcoming.value.filter((p) => new Date(p.scheduledAt).getTime() < Date.now() + 86_400_000).length,
    hint: drafts.value ? `${drafts.value} bài chờ duyệt` : 'không có bài chờ duyệt',
    icon: Promotion,
    tone: 'bg-violet-50 text-violet-600',
  },
  { label: 'Dòng dữ liệu', value: records.value.toLocaleString('vi-VN'), hint: `${datasets.value.length} bộ dữ liệu`, icon: Coin, tone: 'bg-emerald-50 text-emerald-600' },
]);

const flowLink = (f: FlowListItem) => (f.kind === 'pipeline' ? `/pipelines/${f._id}` : `/flows/${f._id}`);
const FLOW_ICON: Record<string, string> = { sources: '📥', pipeline: '🔁', script: '🧩' };
async function runFlow(f: FlowListItem) {
  const res = await tryApi(() => api<Job | { runId: string; jobs: Job[] }>(`/flows/${f._id}/run`, { method: 'POST', body: {} }), 'Đã bắt đầu chạy');
  if (!res) return;
  navigateTo('jobs' in res ? flowLink(f) : `/jobs/${res._id}`);
}
const ago = (iso?: string) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
};
</script>

<template>
  <div class="page">
    <PageHeader title="Tổng quan" subtitle="Tình trạng Chrome, việc đang chạy, lượt sắp đăng, luồng và dữ liệu mới nhất.">
      <template #actions>
        <el-button @click="navigateTo('/flows/new?kind=sources')">+ Kéo dữ liệu</el-button>
        <el-button @click="navigateTo('/publish/posts/new')">+ Bài viết</el-button>
        <el-button type="primary" @click="navigateTo('/pipelines/new')">+ Kéo → Đăng</el-button>
      </template>
    </PageHeader>

    <!-- stats -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <el-card v-for="t in tiles" :key="t.label" shadow="never">
        <div class="flex items-start justify-between">
          <div>
            <div class="eyebrow">{{ t.label }}</div>
            <div class="mt-1.5 text-[28px] font-semibold leading-none tracking-tight">{{ t.value }}</div>
            <div class="mt-2 text-xs text-slate-500">{{ t.hint }}</div>
          </div>
          <span class="icon-badge" :class="t.tone"><el-icon><component :is="t.icon" /></el-icon></span>
        </div>
      </el-card>
    </div>
    <el-card v-if="pool" shadow="never" body-class="!py-3">
      <div class="flex items-center gap-4">
        <span class="eyebrow shrink-0">Công suất</span>
        <el-progress :percentage="usage" :stroke-width="8" class="flex-1" :status="usage >= 100 ? 'warning' : undefined" />
        <span class="hidden shrink-0 text-xs text-slate-500 lg:inline">Giới hạn đặt bằng <code>MAX_CONCURRENCY</code> trong backend/.env</span>
      </div>
    </el-card>

    <div class="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <!-- running -->
      <el-card shadow="never" class="xl:col-span-2">
        <template #header>
          <div class="flex items-center justify-between">
            <span>Đang chạy</span>
            <NuxtLink to="/jobs" class="text-xs font-normal">Tất cả jobs →</NuxtLink>
          </div>
        </template>
        <div v-if="!active.data.value.items.length" class="flex flex-col items-center py-8 text-center">
          <span class="icon-badge mb-3 bg-slate-100 text-slate-400"><el-icon><List /></el-icon></span>
          <div class="text-sm font-medium text-slate-700">Không có job nào đang chạy</div>
          <div class="mt-1 text-xs text-slate-500">Chạy một luồng có sẵn hoặc tạo luồng mới.</div>
        </div>
        <div v-else class="divide-y divide-slate-100">
          <NuxtLink v-for="job in active.data.value.items" :key="job._id" :to="`/jobs/${job._id}`" class="block py-3 text-inherit first:pt-0 last:pb-0 hover:text-inherit">
            <div class="mb-1.5 flex items-center justify-between gap-2">
              <span class="truncate font-medium">{{ job.name }}</span>
              <StatusTag :status="job.status" />
            </div>
            <JobProgress :totals="job.totals" show-counts />
          </NuxtLink>
        </div>
      </el-card>

      <!-- flows -->
      <el-card shadow="never">
        <template #header>
          <div class="flex items-center justify-between">
            <span>Luồng</span>
            <span class="text-xs font-normal"><NuxtLink to="/flows">Kéo</NuxtLink> · <NuxtLink to="/pipelines">Kéo → Đăng</NuxtLink> · <NuxtLink to="/script-flows">Script</NuxtLink></span>
          </div>
        </template>
        <div v-if="!flows.length" class="py-6 text-center">
          <div class="text-sm text-slate-600">Chưa có luồng nào.</div>
          <el-button class="mt-3" type="primary" plain size="small" @click="navigateTo('/flows/new?kind=sources')">Tạo luồng đầu tiên</el-button>
        </div>
        <div v-else class="divide-y divide-slate-100">
          <div v-for="f in flows" :key="f._id" class="flex items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
            <NuxtLink :to="flowLink(f)" class="min-w-0 text-inherit hover:text-indigo-600">
              <div class="truncate text-sm font-medium">{{ FLOW_ICON[f.kind] }} {{ f.name }}</div>
              <div class="text-xs text-slate-500">
                {{ f.runs }} lần chạy{{ f.lastRunAt ? ` · ${ago(f.lastRunAt)}` : '' }}{{ f.autoRun?.enabled && f.autoRun.nextRunAt ? ` · tự chạy ${fmtTime(f.autoRun.nextRunAt)}` : '' }}
              </div>
            </NuxtLink>
            <el-button size="small" @click="runFlow(f)">▶ Chạy</el-button>
          </div>
        </div>
      </el-card>
    </div>

    <!-- upcoming publications -->
    <el-card shadow="never">
      <template #header>
        <div class="flex items-center justify-between">
          <span>Sắp đăng</span>
          <span class="text-xs font-normal">
            <NuxtLink v-if="drafts" :to="{ path: '/publish/posts', query: { status: 'draft' } }" class="mr-3">{{ drafts }} bài chờ duyệt</NuxtLink>
            <NuxtLink to="/publish">Mở Đăng bài →</NuxtLink>
          </span>
        </div>
      </template>
      <div v-if="!upcoming.length" class="py-4 text-center text-sm text-slate-500">Không có lượt đăng nào sắp tới.</div>
      <PublicationTimeline v-else :items="upcoming.slice(0, 6)" show-campaign compact @changed="loadSide" />
    </el-card>

    <div class="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <!-- recent jobs -->
      <el-card shadow="never" class="xl:col-span-2" body-class="!p-0">
        <template #header>Job gần đây</template>
        <el-table :data="recent.data.value.items" @row-click="(row: any) => navigateTo(`/jobs/${row._id}`)">
          <el-table-column label="Loại" width="140">
            <template #default="{ row }">
              <span class="text-xs">{{ JOB_CATEGORY[row.category ?? 'manual'].icon }} {{ JOB_CATEGORY[row.category ?? 'manual'].label }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Tên" prop="name" min-width="220" show-overflow-tooltip />
          <el-table-column label="Trạng thái" width="130">
            <template #default="{ row }"><StatusTag :status="row.status" /></template>
          </el-table-column>
          <el-table-column label="Tiến độ" min-width="180">
            <template #default="{ row }"><JobProgress :totals="row.totals" /></template>
          </el-table-column>
          <el-table-column label="Bắt đầu" width="130">
            <template #default="{ row }"><span class="text-xs text-slate-500">{{ ago(row.createdAt) }}</span></template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- data -->
      <el-card shadow="never">
        <template #header>
          <div class="flex items-center justify-between">
            <span>Dữ liệu mới</span>
            <NuxtLink to="/data" class="text-xs font-normal">Mở Dữ liệu →</NuxtLink>
          </div>
        </template>
        <div v-if="!datasets.length" class="py-6 text-center text-sm text-slate-500">Chưa có dữ liệu.</div>
        <div v-else class="divide-y divide-slate-100">
          <NuxtLink
            v-for="d in datasets.slice(0, 6)"
            :key="d.scope + d.dataset"
            :to="{ path: '/data', query: { scope: d.scope, dataset: d.dataset } }"
            class="flex items-center justify-between gap-2 py-2.5 text-inherit first:pt-0 last:pb-0 hover:text-indigo-600"
          >
            <div class="min-w-0">
              <div class="truncate text-sm font-medium">{{ d.dataset }}</div>
              <div class="truncate text-xs text-slate-500">{{ d.scopeName }} · {{ ago(d.lastSeenAt) }}</div>
            </div>
            <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{{ d.count }}</span>
          </NuxtLink>
        </div>
      </el-card>
    </div>
  </div>
</template>
