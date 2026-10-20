<script setup lang="ts">
import type { Job, Paged, Task, TaskPatch } from '~/types/api';

/**
 * Log in once with a profile: opens a headed Chrome on the page, pauses, and
 * shows the live view here; "Resume" closes Chrome and keeps the session.
 */
const props = defineProps<{ profileId: string; profileName: string; loginUrl?: string }>();
const emit = defineEmits<{ done: [] }>();
const { api } = useApi();

const url = ref(props.loginUrl || 'https://');
const task = ref<Task>();
const starting = ref(false);

useLiveRoom('subscribe:job', () => (task.value ? { jobId: task.value.jobId } : null));
useLiveEvent<TaskPatch>('task:update', (patch) => {
  if (task.value && patch._id === task.value._id) {
    Object.assign(task.value, patch);
    if (patch.status === 'done') emit('done');
  }
});

async function open() {
  if (!/^https?:\/\/.+/.test(url.value)) return ElMessage.warning('Nhập trang đăng nhập, ví dụ https://www.facebook.com');
  starting.value = true;
  if (url.value !== props.loginUrl) {
    await api(`/profiles/${props.profileId}`, { method: 'PUT', body: { name: props.profileName, loginUrl: url.value } }).catch(() => undefined);
  }
  const job = await tryApi(() =>
    api<Job>('/jobs', {
      method: 'POST',
      body: {
        name: `Login: ${props.profileName}`,
        category: 'login',
        profileId: props.profileId,
        headless: false,
        stepTimeout: 60_000,
        actions: [
          { type: 'goto', url: url.value },
          { type: 'pause', message: 'Đăng nhập trong cửa sổ Chrome, xong thì bấm Resume để lưu.' },
        ],
      },
    }),
  );
  if (job) {
    const tasks = await api<Paged<Task>>(`/jobs/${job._id}/tasks`);
    task.value = tasks.items[0];
  }
  starting.value = false;
}

async function resume() {
  await tryApi(() => api(`/tasks/${task.value!._id}/resume`, { method: 'POST' }));
}

const live = computed(() => task.value?.status === 'running' || task.value?.status === 'paused');
</script>

<template>
  <div class="rounded border border-gray-200 p-3">
    <template v-if="!task || task.status === 'failed' || task.status === 'cancelled'">
      <div class="mb-2 text-sm text-gray-600">
        Mở Chrome với profile <b>{{ props.profileName }}</b> để đăng nhập một lần; phiên đăng nhập được giữ cho các lần chạy sau.
      </div>
      <div class="flex gap-2">
        <el-input v-model="url" placeholder="https://www.facebook.com" class="!w-96" />
        <el-button type="primary" :loading="starting" @click="open">Mở Chrome để đăng nhập</el-button>
      </div>
      <div v-if="task" class="mt-2 text-xs text-red-600">Lần trước: {{ task.status }} {{ task.error?.message }}</div>
    </template>

    <template v-else-if="task && live">
      <div class="mb-2 flex items-center justify-between">
        <span class="text-sm">
          <StatusTag :status="task.status" /> Đăng nhập trong <b>cửa sổ Chrome</b> vừa mở (hoặc ngay trên màn hình dưới đây), xong bấm Resume.
        </span>
        <el-button type="success" :disabled="task.status !== 'paused'" @click="resume">Resume: lưu đăng nhập</el-button>
      </div>
      <div class="max-w-xl"><LiveFrame :task-id="task._id" quality="low" /></div>
    </template>

    <el-alert v-else-if="task && task.status === 'done'" type="success" :closable="false" show-icon title="Đã lưu đăng nhập vào profile" />
    <div v-else-if="task" class="text-sm text-gray-500"><StatusTag :status="task.status" /> Đang chờ…</div>
  </div>
</template>
