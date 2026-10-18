<script setup lang="ts">
import type { Job, JobPatch, Paged, Task, TaskPatch } from '~/types/api';

const route = useRoute();
const id = computed(() => route.params.id as string);
const { api } = useApi();

const job = ref<Job>();
const tasks = ref<Task[]>([]);
const total = ref(0);
const filter = reactive({ status: '', page: 1, limit: 48 });

const { cancel, retry, remove } = useJobActions(() => loadTasks());

async function loadJob() {
  job.value = await tryApi(() => api<Job>(`/jobs/${id.value}`));
}
async function loadTasks() {
  const res = await tryApi(() =>
    api<Paged<Task>>(`/jobs/${id.value}/tasks`, {
      query: { ...filter, status: filter.status || undefined },
    }),
  );
  if (!res) return;
  tasks.value = res.items;
  total.value = res.total;
}

watch(id, () => (loadJob(), loadTasks()), { immediate: true });
watch(() => [filter.status, filter.page, filter.limit], loadTasks);

useLiveRoom('subscribe:job', () => ({ jobId: id.value }));
useLiveEvent<JobPatch>('job:update', (patch) => {
  if (job.value && patch._id === job.value._id) Object.assign(job.value, patch);
});
useLiveEvent<TaskPatch>('task:update', (patch) => {
  if (patch.jobId !== id.value) return;
  const task = tasks.value.find((t) => t._id === patch._id);
  if (task) Object.assign(task, patch);
});

const running = computed(() => job.value?.status === 'running' || job.value?.status === 'queued');
const duration = computed(() => {
  if (!job.value?.startedAt) return '';
  const end = job.value.finishedAt ? new Date(job.value.finishedAt) : new Date();
  return `${Math.round((end.getTime() - new Date(job.value.startedAt).getTime()) / 1000)}s`;
});

async function onDelete() {
  if (job.value && (await remove(job.value))) navigateTo('/jobs');
}

function exportResults() {
  const rows = tasks.value.map((t) => ({ name: t.name, status: t.status, vars: t.vars, result: t.result, error: t.error }));
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${job.value?.name ?? 'job'}-results.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
</script>

<template>
  <div v-if="job" class="page">
    <PageHeader :title="job.name" back="/jobs">
      <template #badge><StatusTag :status="job.status" /></template>
      <template #subtitle>
        <span v-if="job.flowId">Thuộc luồng · <NuxtLink :to="`/flows/${job.flowId}`">mở luồng</NuxtLink> · </span>
        Bắt đầu {{ job.startedAt ? fmtDate(job.startedAt) : '—' }}<span v-if="duration"> · {{ duration }}</span>
      </template>
      <template #actions>
        <el-button @click="exportResults">Tải kết quả (trang này)</el-button>
        <el-button v-if="running" type="warning" @click="cancel(job)">Huỷ job</el-button>
        <template v-else-if="job.totals.failed || job.totals.cancelled">
          <el-dropdown v-if="job.scriptId" split-button type="primary" @click="retry(job)" @command="retry(job, true)">
            Chạy lại task lỗi
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="latest">Retry bằng script mới nhất (sau khi đã sửa script)</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button v-else type="primary" @click="retry(job)">Chạy lại task lỗi</el-button>
        </template>
        <el-button v-if="!running" type="danger" plain @click="onDelete">Xoá</el-button>
      </template>
    </PageHeader>

    <el-card shadow="never">
      <JobProgress :totals="job.totals" show-counts />
      <div class="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
        <div><div class="eyebrow">Song song</div><div class="mt-0.5 text-sm font-medium">{{ job.concurrency }} Chrome</div></div>
        <div><div class="eyebrow">Chế độ</div><div class="mt-0.5 text-sm font-medium">{{ job.headless ? 'Ẩn (headless)' : 'Hiện cửa sổ (headed)' }}</div></div>
        <div><div class="eyebrow">Thử lại khi lỗi</div><div class="mt-0.5 text-sm font-medium">{{ job.maxRetries }} lần</div></div>
        <div><div class="eyebrow">Timeout mỗi bước</div><div class="mt-0.5 text-sm font-medium">{{ job.stepTimeout / 1000 }} giây</div></div>
      </div>
    </el-card>

    <div class="flex items-center justify-between">
      <el-radio-group v-model="filter.status" size="small" @change="filter.page = 1">
        <el-radio-button value="">Tất cả</el-radio-button>
        <el-radio-button value="running,paused">Đang chạy</el-radio-button>
        <el-radio-button value="queued">Đang chờ</el-radio-button>
        <el-radio-button value="done">Hoàn tất</el-radio-button>
        <el-radio-button value="failed">Lỗi</el-radio-button>
        <el-radio-button value="cancelled">Đã huỷ</el-radio-button>
      </el-radio-group>
      <el-pagination
        v-model:current-page="filter.page"
        :page-size="filter.limit"
        :total="total"
        layout="total, prev, pager, next"
        small
      />
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      <TaskCard v-for="t in tasks" :key="t._id" :task="t" />
    </div>
    <el-empty v-if="!tasks.length" description="Không có task nào" />
  </div>
</template>
