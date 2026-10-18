<script setup lang="ts">
import type { Job } from '~/types/api';

const filter = reactive({ status: '', page: 1, limit: 20 });
const { data, loading, load } = useJobsList(() => ({ ...filter, status: filter.status || undefined }));
const { cancel, retry, remove } = useJobActions(load);
const { isPhone } = useBreakpoint();

const STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'];
const STATUS_LABEL: Record<string, string> = { queued: 'Đang chờ', running: 'Đang chạy', done: 'Hoàn tất', failed: 'Lỗi', cancelled: 'Đã huỷ' };
watch(
  () => filter.status,
  () => (filter.page = 1),
);
</script>

<template>
  <div class="page">
    <PageHeader title="Jobs" subtitle="Mỗi job là một lần chạy script cho danh sách đầu vào; mỗi đầu vào là một task.">
      <template #actions>
        <el-select v-model="filter.status" placeholder="Mọi trạng thái" clearable class="!w-44">
          <el-option v-for="s in STATUSES" :key="s" :label="STATUS_LABEL[s]" :value="s" />
        </el-select>
        <el-button type="primary" @click="navigateTo('/jobs/new')">+ New job</el-button>
      </template>
    </PageHeader>

    <!-- phones: cards instead of a wide table -->
    <div v-if="isPhone" class="space-y-3">
      <el-card v-for="row in data.items" :key="row._id" shadow="never" body-class="!p-3.5" @click="navigateTo(`/jobs/${row._id}`)">
        <div class="mb-2 flex items-start justify-between gap-2">
          <span class="font-medium leading-snug">{{ row.name }}</span>
          <StatusTag :status="row.status" />
        </div>
        <JobProgress :totals="row.totals" show-counts />
        <div class="mt-2 flex items-center justify-between text-xs text-slate-500">
          <span>{{ fmtDate(row.createdAt) }} · {{ row.headless ? 'headless' : 'headed' }}</span>
          <span @click.stop>
            <el-button v-if="row.status === 'running' || row.status === 'queued'" size="small" @click="cancel(row)">Huỷ</el-button>
            <el-button v-else size="small" type="danger" plain @click="remove(row)">Xoá</el-button>
          </span>
        </div>
      </el-card>
      <el-empty v-if="!data.items.length && !loading" description="Chưa có job nào" />
      <div class="flex justify-center">
        <el-pagination v-model:current-page="filter.page" :page-size="filter.limit" :total="data.total" layout="prev, pager, next" small />
      </div>
    </div>

    <el-card v-else shadow="never" body-class="!p-0">
      <el-table v-loading="loading" :data="data.items" @row-click="(row: any) => navigateTo(`/jobs/${row._id}`)">
        <el-table-column label="Tên" prop="name" min-width="200" show-overflow-tooltip />
        <el-table-column label="Trạng thái" width="130">
          <template #default="{ row }"><StatusTag :status="row.status" /></template>
        </el-table-column>
        <el-table-column label="Tiến độ" min-width="260">
          <template #default="{ row }"><JobProgress :totals="row.totals" show-counts /></template>
        </el-table-column>
        <el-table-column label="Song song" prop="concurrency" width="100" align="center" />
        <el-table-column label="Chế độ" width="100">
          <template #default="{ row }">{{ row.headless ? 'headless' : 'headed' }}</template>
        </el-table-column>
        <el-table-column label="Tạo lúc" width="170">
          <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="" width="200" align="right" fixed="right">
          <template #default="{ row }">
            <div @click.stop>
              <el-button v-if="row.status === 'running' || row.status === 'queued'" size="small" @click="cancel(row as Job)">
                Huỷ
              </el-button>
              <el-button v-else-if="row.totals.failed || row.totals.cancelled" size="small" @click="retry(row as Job)">
                Chạy lại lỗi
              </el-button>
              <el-button
                v-if="row.status !== 'running' && row.status !== 'queued'"
                size="small"
                type="danger"
                plain
                @click="remove(row as Job)"
              >
                Xoá
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div class="flex justify-end p-3">
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
