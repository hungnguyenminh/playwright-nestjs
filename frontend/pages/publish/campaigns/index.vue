<script setup lang="ts">
import type { Campaign } from '~/types/api';

const { api } = useApi();
const list = ref<Campaign[]>([]);
const loading = ref(true);
async function load() {
  list.value = (await tryApi(() => api<Campaign[]>('/campaigns'))) ?? [];
  loading.value = false;
}
onMounted(load);
useLiveRoom('subscribe:jobs', {});
let timer: ReturnType<typeof setTimeout> | undefined;
useLiveEvent('publication:update', () => {
  clearTimeout(timer);
  timer = setTimeout(load, 800);
});

const scheduleText = (c: Campaign) => {
  const s = c.schedule;
  if (s.mode === 'once') return s.at ? `1 lần, ${fmtDate(s.at)}` : '1 lần';
  if (s.mode === 'slots') return `${s.slots.length} mốc giờ`;
  return `mỗi ${s.every} ${({ minute: 'phút', hour: 'giờ', day: 'ngày' } as const)[s.unit]}${s.count ? `, ${s.count} lần` : ', không giới hạn'}`;
};
</script>

<template>
  <div class="page">
    <PageHeader title="Đăng bài" subtitle="Lịch đăng: nơi đăng, tài khoản, bài và thời gian.">
      <template #actions>
        <el-button type="primary" @click="navigateTo('/publish/campaigns/new')">+ Lịch đăng mới</el-button>
      </template>
    </PageHeader>
    <PublishTabs />

    <el-card shadow="never" :body-class="list.length ? '!p-0' : ''">
      <el-empty v-if="!loading && !list.length" description="Chưa có lịch đăng nào">
        <el-button type="primary" @click="navigateTo('/publish/campaigns/new')">Tạo lịch đăng đầu tiên</el-button>
      </el-empty>
      <el-table v-else v-loading="loading" :data="list" @row-click="(row: Campaign) => navigateTo(`/publish/campaigns/${row._id}`)">
        <el-table-column label="Lịch đăng" min-width="220">
          <template #default="{ row }">
            <div class="font-medium">{{ row.name }}</div>
            <div class="text-xs text-slate-500">{{ scheduleText(row as Campaign) }}{{ row.dryRun ? ' · đăng thử' : '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="Nơi đăng" min-width="240">
          <template #default="{ row }">
            <div v-for="(d, i) in row.destinations" :key="i" class="truncate text-xs">
              {{ destinationLabel(d) }} · {{ d.profileIds.length }} tài khoản{{ d.accountMode === 'rotate' ? ' xoay vòng' : '' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="Trạng thái" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="CAMPAIGN_STATUS[row.status as keyof typeof CAMPAIGN_STATUS].type">{{ CAMPAIGN_STATUS[row.status as keyof typeof CAMPAIGN_STATUS].label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Lượt đăng" min-width="200">
          <template #default="{ row }">
            <span class="text-xs text-slate-600">
              {{ (row.totals?.published ?? 0) + (row.totals?.pending_approval ?? 0) }} đã đăng · {{ (row.totals?.scheduled ?? 0) + (row.totals?.waiting ?? 0) }} chờ
              <span v-if="row.totals?.failed || row.totals?.unknown" class="text-red-600">· {{ (row.totals?.failed ?? 0) + (row.totals?.unknown ?? 0) }} lỗi</span>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="Lượt tới" width="150">
          <template #default="{ row }">{{ row.nextAt ? fmtDate(row.nextAt) : '—' }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
