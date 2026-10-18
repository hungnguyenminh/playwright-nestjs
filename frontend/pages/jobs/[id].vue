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
  <div v-if="job" class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <el-button text @click="navigateTo('/jobs')">←</el-button>
        <h1 class="m-0 text-xl font-semibold">{{ job.name }}</h1>
        <StatusTag :status="job.status" />
      </div>
      <div class="flex gap-2">
        <el-button @click="exportResults">Export results (page)</el-button>
        <el-button v-if="running" type="warning" @click="cancel(job)">Cancel job</el-button>
        <el-button v-else-if="job.totals.failed || job.totals.cancelled" type="primary" @click="retry(job)">
          Retry failed
        </el-button>
        <el-button v-if="!running" type="danger" plain @click="onDelete">Delete</el-button>
      </div>
    </div>

    <el-card shadow="never">
      <JobProgress :totals="job.totals" show-counts />
      <div class="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
        <span>concurrency {{ job.concurrency }}</span>
        <span>{{ job.headless ? 'headless' : 'headed' }}</span>
        <span>retries {{ job.maxRetries }}</span>
        <span>step timeout {{ job.stepTimeout / 1000 }}s</span>
        <span v-if="job.startedAt">started {{ new Date(job.startedAt).toLocaleString() }}</span>
        <span v-if="duration">duration {{ duration }}</span>
      </div>
    </el-card>

    <div class="flex items-center justify-between">
      <el-radio-group v-model="filter.status" size="small" @change="filter.page = 1">
        <el-radio-button value="">All</el-radio-button>
        <el-radio-button value="running,paused">Running</el-radio-button>
        <el-radio-button value="queued">Queued</el-radio-button>
        <el-radio-button value="done">Done</el-radio-button>
        <el-radio-button value="failed">Failed</el-radio-button>
        <el-radio-button value="cancelled">Cancelled</el-radio-button>
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
    <el-empty v-if="!tasks.length" description="No tasks" />
  </div>
</template>
