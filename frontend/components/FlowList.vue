<script setup lang="ts">
import type { FlowListItem, Job } from '~/types/api';

/** Saved flows of one kind (crawl sources, or hand-written scripts), with run / edit / delete. */
const props = defineProps<{ kind: 'sources' | 'script'; title: string; subtitle: string }>();

const { api } = useApi();
const flows = ref<FlowListItem[]>([]);
const loading = ref(false);
const { isPhone } = useBreakpoint();

async function load() {
  loading.value = true;
  flows.value = (await tryApi(() => api<FlowListItem[]>('/flows', { query: { kind: props.kind } }))) ?? [];
  loading.value = false;
}
load();

// Keep the "last run" column live.
useLiveRoom('subscribe:jobs', {});
useLiveEvent<Partial<Job> & { _id: string }>('job:update', (patch) => {
  const f = flows.value.find((x) => x.lastJob?._id === patch._id);
  if (f?.lastJob) Object.assign(f.lastJob, patch);
});

async function runNow(f: FlowListItem) {
  const res = await tryApi(() => api<Job | { runId: string; jobs: Job[] }>(`/flows/${f._id}/run`, { method: 'POST', body: {} }), 'Đã bắt đầu chạy');
  if (!res) return;
  // Source flows start one job per source: show them on the flow page.
  if ('jobs' in res) navigateTo(res.jobs.length === 1 ? `/jobs/${res.jobs[0]._id}` : `/flows/${f._id}`);
  else navigateTo(`/jobs/${res._id}`);
}

async function remove(f: FlowListItem) {
  const ok = await ElMessageBox.confirm(
    `Xoá luồng "${f.name}"? Các job đã chạy và dữ liệu đã lấy vẫn được giữ.`,
    'Xoá luồng',
    { type: 'warning', confirmButtonText: 'Xoá' },
  ).catch(() => false);
  if (!ok) return;
  await tryApi(() => api(`/flows/${f._id}`, { method: 'DELETE' }), 'Đã xoá');
  load();
}
</script>

<template>
  <div class="page">
    <PageHeader :title="title" :subtitle="subtitle">
      <template #actions>
        <el-button type="primary" @click="navigateTo(`/flows/new?kind=${kind}`)">+ Tạo luồng mới</el-button>
      </template>
    </PageHeader>
    <slot name="tabs" />

    <!-- phones: cards instead of a wide table -->
    <div v-if="isPhone && flows.length" class="space-y-3">
      <el-card v-for="f in flows" :key="f._id" shadow="never" body-class="!p-3.5" @click="navigateTo(`/flows/${f._id}`)">
        <div class="font-medium">{{ f.name }}</div>
        <div v-if="f.description" class="mt-0.5 line-clamp-2 text-xs text-slate-500">{{ f.description }}</div>
        <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>{{ f.kind === 'sources' ? 'Nguồn' : 'Script' }}: {{ f.scriptName }}</span>
          <span v-if="f.profileName">Profile: {{ f.profileName }}</span>
          <span>{{ f.runs }} lần chạy</span>
        </div>
        <div v-if="f.lastJob" class="mt-2"><JobProgress :totals="f.lastJob.totals" /></div>
        <div class="mt-3 flex gap-2" @click.stop>
          <el-button size="small" type="primary" @click="runNow(f)">▶ Chạy</el-button>
          <el-button size="small" @click="navigateTo(`/flows/new?id=${f._id}`)">Sửa</el-button>
          <el-button size="small" type="danger" plain @click="remove(f)">Xoá</el-button>
        </div>
      </el-card>
    </div>

    <el-card v-else shadow="never" :body-class="flows.length ? '!p-0' : ''">
      <el-empty v-if="!loading && !flows.length" description="Chưa có luồng nào">
        <el-button type="primary" @click="navigateTo(`/flows/new?kind=${kind}`)">Tạo luồng đầu tiên</el-button>
      </el-empty>
      <el-table v-else v-loading="loading" :data="flows" @row-click="(row: any) => navigateTo(`/flows/${row._id}`)">
        <el-table-column label="Luồng" min-width="240">
          <template #default="{ row }">
            <div class="font-medium">{{ row.name }}</div>
            <div class="truncate text-xs text-gray-500">{{ row.description }}</div>
          </template>
        </el-table-column>
        <el-table-column label="Profile" width="150">
          <template #default="{ row }">{{ row.profileName || '—' }}</template>
        </el-table-column>
        <el-table-column label="Script / Nguồn" prop="scriptName" min-width="180" show-overflow-tooltip />
        <el-table-column label="Lần chạy" prop="runs" width="90" align="center" />
        <el-table-column label="Lần chạy gần nhất" min-width="220">
          <template #default="{ row }">
            <div v-if="row.lastJob" class="space-y-1">
              <div class="flex items-center gap-2">
                <StatusTag :status="row.lastJob.status" />
                <span class="text-xs text-gray-500">{{ row.lastRunAt ? fmtDate(row.lastRunAt) : '' }}</span>
              </div>
              <JobProgress :totals="row.lastJob.totals" />
            </div>
            <span v-else class="text-gray-400">chưa chạy</span>
          </template>
        </el-table-column>
        <el-table-column width="230" align="right" fixed="right">
          <template #default="{ row }">
            <div @click.stop>
              <el-button size="small" type="primary" @click="runNow(row as FlowListItem)">▶ Chạy</el-button>
              <el-button size="small" @click="navigateTo(`/flows/new?id=${row._id}`)">Sửa</el-button>
              <el-button size="small" type="danger" plain @click="remove(row as FlowListItem)">Xoá</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
