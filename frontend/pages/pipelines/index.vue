<script setup lang="ts">
import type { FlowListItem } from '~/types/api';

/** Crawl → publish flows. */
const { api } = useApi();
const flows = ref<FlowListItem[]>([]);
const loading = ref(true);
async function load() {
  flows.value = (await tryApi(() => api<FlowListItem[]>('/flows', { query: { kind: 'pipeline' } }))) ?? [];
  loading.value = false;
}
onMounted(load);

async function runNow(f: FlowListItem) {
  if (await tryApi(() => api(`/flows/${f._id}/run`, { method: 'POST', body: {} }), 'Đã bắt đầu kéo dữ liệu')) navigateTo(`/pipelines/${f._id}`);
}
</script>

<template>
  <div class="page">
    <PageHeader title="Kéo → Đăng" subtitle="Luồng tự động: kéo dữ liệu định kỳ → AI viết bài từ dữ liệu mới → tự đăng theo lịch.">
      <template #actions>
        <el-button type="primary" @click="navigateTo('/pipelines/new')">+ Luồng Kéo → Đăng</el-button>
      </template>
    </PageHeader>

    <el-card shadow="never" :body-class="flows.length ? '!p-0' : ''">
      <el-empty v-if="!loading && !flows.length" description="Chưa có luồng Kéo → Đăng nào">
        <el-button type="primary" @click="navigateTo('/pipelines/new')">Tạo luồng đầu tiên</el-button>
      </el-empty>
      <el-table v-else v-loading="loading" :data="flows" @row-click="(row: FlowListItem) => navigateTo(`/pipelines/${row._id}`)">
        <el-table-column label="Luồng" min-width="220">
          <template #default="{ row }">
            <div class="font-medium">{{ row.name }}</div>
            <div class="truncate text-xs text-slate-500">{{ row.description }}</div>
          </template>
        </el-table-column>
        <el-table-column label="Kéo từ" prop="scriptName" min-width="160" show-overflow-tooltip />
        <el-table-column label="Tự kéo" width="150">
          <template #default="{ row }">
            <span v-if="row.autoRun?.enabled" class="text-xs">mỗi {{ row.autoRun.every }} {{ row.autoRun.unit === 'day' ? 'ngày' : 'giờ' }}</span>
            <span v-else class="text-xs text-slate-400">tắt</span>
          </template>
        </el-table-column>
        <el-table-column label="Viết cho" width="160">
          <template #default="{ row }">
            <span class="text-xs">{{ (row.generate?.platforms ?? []).map((p: keyof typeof PLATFORM_LABEL) => PLATFORM_LABEL[p]).join(', ') }}</span>
            <div class="text-xs text-slate-500">{{ row.generate?.approval === 'auto' ? 'tự duyệt' : 'chờ duyệt' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="Lần kéo" prop="runs" width="90" align="center" />
        <el-table-column label="Kéo gần nhất" width="150">
          <template #default="{ row }">{{ row.lastRunAt ? fmtDate(row.lastRunAt) : '—' }}</template>
        </el-table-column>
        <el-table-column width="120" align="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click.stop="runNow(row as FlowListItem)">▶ Chạy</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
