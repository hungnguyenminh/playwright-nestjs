<script setup lang="ts">
import type { Job, JobCategory } from '~/types/api';
import { JOB_CATEGORY } from '~/utils/publish';

/** Every run, whatever started it, filterable by kind of work and status. */
const route = useRoute();
const router = useRouter();
const filter = reactive({
  status: (route.query.status as string) || '',
  categories: ((route.query.category as string) || '').split(',').filter(Boolean) as JobCategory[],
  page: 1,
  limit: 20,
});
const { data, loading, load } = useJobsList(() => ({
  page: filter.page,
  limit: filter.limit,
  status: filter.status || undefined,
  category: filter.categories.join(',') || undefined,
}));
const { cancel, retry, remove } = useJobActions(load);
const { isPhone } = useBreakpoint();

const STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'];
const STATUS_LABEL: Record<string, string> = { queued: 'Đang chờ', running: 'Đang chạy', done: 'Hoàn tất', failed: 'Lỗi', cancelled: 'Đã huỷ' };
watch(
  () => [filter.status, filter.categories.join(',')],
  () => {
    filter.page = 1;
    router.replace({ query: { ...(filter.status ? { status: filter.status } : {}), ...(filter.categories.length ? { category: filter.categories.join(',') } : {}) } });
  },
);
function toggle(c: JobCategory) {
  filter.categories = filter.categories.includes(c) ? filter.categories.filter((x) => x !== c) : [...filter.categories, c];
}
const cat = (j: Job) => JOB_CATEGORY[j.category ?? 'manual'];
</script>

<template>
  <div class="page">
    <PageHeader title="Lịch sử chạy (Jobs)" subtitle="Mọi lần chạy do Kéo dữ liệu, Đăng bài, Kéo → Đăng hay chạy tay sinh ra. Mỗi job gồm một hoặc nhiều task (mỗi đầu vào một task).">
      <template #actions>
        <el-button type="primary" @click="navigateTo('/jobs/new')">+ New job</el-button>
      </template>
    </PageHeader>

    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-slate-500">Loại:</span>
      <button
        v-for="(c, key) in JOB_CATEGORY"
        :key="key"
        type="button"
        class="cat-chip"
        :class="{ on: filter.categories.includes(key as JobCategory) }"
        @click="toggle(key as JobCategory)"
      >
        {{ c.icon }} {{ c.label }}
      </button>
      <el-button v-if="filter.categories.length" link size="small" @click="filter.categories = []">Bỏ lọc</el-button>
      <el-select v-model="filter.status" placeholder="Mọi trạng thái" clearable size="small" class="!ml-auto !w-40">
        <el-option v-for="s in STATUSES" :key="s" :label="STATUS_LABEL[s]" :value="s" />
      </el-select>
    </div>

    <!-- phones: cards instead of a wide table -->
    <div v-if="isPhone" class="space-y-3">
      <el-card v-for="row in data.items" :key="row._id" shadow="never" body-class="!p-3.5" @click="navigateTo(`/jobs/${row._id}`)">
        <div class="mb-1 flex items-start justify-between gap-2">
          <span class="font-medium leading-snug">{{ row.name }}</span>
          <StatusTag :status="row.status" />
        </div>
        <el-tag size="small" :type="cat(row).type" disable-transitions class="mb-2">{{ cat(row).icon }} {{ cat(row).label }}</el-tag>
        <JobProgress :totals="row.totals" show-counts />
        <div class="mt-2 flex items-center justify-between text-xs text-slate-500">
          <span>{{ fmtDate(row.createdAt) }} · {{ row.headless ? 'headless' : 'headed' }}</span>
          <span @click.stop>
            <el-button v-if="row.status === 'running' || row.status === 'queued'" size="small" @click="cancel(row)">Huỷ</el-button>
            <el-button v-else size="small" type="danger" plain @click="remove(row)">Xoá</el-button>
          </span>
        </div>
      </el-card>
      <el-empty v-if="!data.items.length && !loading" description="Không có job nào" />
      <div class="flex justify-center">
        <el-pagination v-model:current-page="filter.page" :page-size="filter.limit" :total="data.total" layout="prev, pager, next" small />
      </div>
    </div>

    <el-card v-else shadow="never" body-class="!p-0">
      <el-table v-loading="loading" :data="data.items" @row-click="(row: any) => navigateTo(`/jobs/${row._id}`)">
        <el-table-column label="Loại" width="150">
          <template #default="{ row }">
            <el-tag size="small" :type="cat(row as Job).type" disable-transitions>{{ cat(row as Job).icon }} {{ cat(row as Job).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Tên" prop="name" min-width="220" show-overflow-tooltip />
        <el-table-column label="Trạng thái" width="130">
          <template #default="{ row }"><StatusTag :status="row.status" /></template>
        </el-table-column>
        <el-table-column label="Tiến độ" min-width="240">
          <template #default="{ row }"><JobProgress :totals="row.totals" show-counts /></template>
        </el-table-column>
        <el-table-column label="Chế độ" width="100">
          <template #default="{ row }">{{ row.headless ? 'headless' : 'headed' }}</template>
        </el-table-column>
        <el-table-column label="Tạo lúc" width="160">
          <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="" width="200" align="right" fixed="right">
          <template #default="{ row }">
            <div @click.stop>
              <el-button v-if="row.status === 'running' || row.status === 'queued'" size="small" @click="cancel(row as Job)">Huỷ</el-button>
              <el-button v-else-if="(row.totals.failed || row.totals.cancelled) && row.category !== 'publish'" size="small" @click="retry(row as Job)">
                Chạy lại lỗi
              </el-button>
              <el-button v-if="row.status !== 'running' && row.status !== 'queued'" size="small" type="danger" plain @click="remove(row as Job)">Xoá</el-button>
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

<style scoped>
.cat-chip {
  border: 1px solid var(--el-border-color);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 13px;
  background: #fff;
  cursor: pointer;
}
.cat-chip.on {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
</style>
