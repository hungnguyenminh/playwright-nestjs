<script setup lang="ts">
import type { PoolStats } from '~/types/api';

const { api } = useApi();
const pool = ref<PoolStats>();

const active = useJobsList(() => ({ status: 'queued,running', limit: 50 }));
const recent = useJobsList(() => ({ limit: 10 }));

async function loadStats() {
  pool.value = (await api<{ pool: PoolStats }>('/system').catch(() => undefined))?.pool;
}
loadStats();
const timer = setInterval(loadStats, 3000);
onBeforeUnmount(() => clearInterval(timer));

const tiles = computed(() => [
  { label: 'Chrome contexts', value: pool.value ? `${pool.value.activeContexts} / ${pool.value.maxConcurrency}` : '—' },
  { label: 'Waiting for a slot', value: pool.value?.queued ?? '—' },
  { label: 'Chrome processes', value: pool.value?.browsers ?? '—' },
  { label: 'Active jobs', value: active.data.value.total },
]);
</script>

<template>
  <div class="space-y-5">
    <div class="flex items-center justify-between">
      <h1 class="m-0 text-xl font-semibold">Dashboard</h1>
      <el-button type="primary" @click="navigateTo('/jobs/new')">New job</el-button>
    </div>

    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <el-card v-for="t in tiles" :key="t.label" shadow="never">
        <div class="text-xs text-gray-500">{{ t.label }}</div>
        <div class="mt-1 text-2xl font-semibold">{{ t.value }}</div>
      </el-card>
    </div>

    <el-card shadow="never" header="Running now">
      <el-empty v-if="!active.data.value.items.length" description="No job is running" :image-size="60" />
      <div v-else class="space-y-4">
        <NuxtLink
          v-for="job in active.data.value.items"
          :key="job._id"
          :to="`/jobs/${job._id}`"
          class="block text-inherit"
        >
          <div class="mb-1 flex items-center gap-2">
            <span class="font-medium">{{ job.name }}</span>
            <StatusTag :status="job.status" />
          </div>
          <JobProgress :totals="job.totals" show-counts />
        </NuxtLink>
      </div>
    </el-card>

    <el-card shadow="never" header="Recent jobs">
      <el-table :data="recent.data.value.items" size="small" @row-click="(row: any) => navigateTo(`/jobs/${row._id}`)">
        <el-table-column label="Name" prop="name" min-width="200" />
        <el-table-column label="Status" width="120">
          <template #default="{ row }"><StatusTag :status="row.status" /></template>
        </el-table-column>
        <el-table-column label="Progress" min-width="200">
          <template #default="{ row }"><JobProgress :totals="row.totals" /></template>
        </el-table-column>
        <el-table-column label="Created" width="180">
          <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
