<script setup lang="ts">
import type { Job } from '~/types/api';

const filter = reactive({ status: '', page: 1, limit: 20 });
const { data, loading, load } = useJobsList(() => ({ ...filter, status: filter.status || undefined }));
const { cancel, retry, remove } = useJobActions(load);

const STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'];
watch(
  () => filter.status,
  () => (filter.page = 1),
);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="m-0 text-xl font-semibold">Jobs</h1>
      <div class="flex gap-2">
        <el-select v-model="filter.status" placeholder="All statuses" clearable class="!w-44">
          <el-option v-for="s in STATUSES" :key="s" :label="s" :value="s" />
        </el-select>
        <el-button type="primary" @click="navigateTo('/jobs/new')">New job</el-button>
      </div>
    </div>

    <el-card shadow="never">
      <el-table v-loading="loading" :data="data.items" @row-click="(row: any) => navigateTo(`/jobs/${row._id}`)">
        <el-table-column label="Name" prop="name" min-width="200" />
        <el-table-column label="Status" width="120">
          <template #default="{ row }"><StatusTag :status="row.status" /></template>
        </el-table-column>
        <el-table-column label="Progress" min-width="260">
          <template #default="{ row }"><JobProgress :totals="row.totals" show-counts /></template>
        </el-table-column>
        <el-table-column label="Concurrency" prop="concurrency" width="110" align="center" />
        <el-table-column label="Mode" width="100">
          <template #default="{ row }">{{ row.headless ? 'headless' : 'headed' }}</template>
        </el-table-column>
        <el-table-column label="Created" width="180">
          <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="" width="220" align="right">
          <template #default="{ row }">
            <div @click.stop>
              <el-button v-if="row.status === 'running' || row.status === 'queued'" size="small" @click="cancel(row as Job)">
                Cancel
              </el-button>
              <el-button v-else-if="row.totals.failed || row.totals.cancelled" size="small" @click="retry(row as Job)">
                Retry failed
              </el-button>
              <el-button
                v-if="row.status !== 'running' && row.status !== 'queued'"
                size="small"
                type="danger"
                plain
                @click="remove(row as Job)"
              >
                Delete
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="filter.page"
          v-model:page-size="filter.limit"
          :total="data.total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
        />
      </div>
    </el-card>
  </div>
</template>
