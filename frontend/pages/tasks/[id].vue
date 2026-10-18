<script setup lang="ts">
import type { Artifact, Task, TaskLog, TaskPatch } from '~/types/api';

const route = useRoute();
const id = computed(() => route.params.id as string);
const { api, artifactUrl } = useApi();

const task = ref<Task>();
const logs = ref<TaskLog[]>([]);
const artifacts = ref<Artifact[]>([]);

async function load() {
  const [t, l, a] = await Promise.all([
    tryApi(() => api<Task>(`/tasks/${id.value}`)),
    tryApi(() => api<TaskLog[]>(`/tasks/${id.value}/logs`)),
    tryApi(() => api<Artifact[]>(`/tasks/${id.value}/artifacts`)),
  ]);
  task.value = t;
  logs.value = l ?? [];
  artifacts.value = a ?? [];
}
watch(id, load, { immediate: true });

const live = computed(() => task.value?.status === 'running' || task.value?.status === 'paused');

// Logs + status always; frames come through <LiveFrame> while running.
useLiveRoom('subscribe:task', () => ({ taskId: id.value, frames: false }));
useLiveEvent<TaskPatch>('task:update', async (patch) => {
  if (!task.value || patch._id !== id.value) return;
  const wasLive = live.value;
  // A retry starts a fresh attempt: drop the previous attempt's logs from view.
  if (patch.status === 'running' && patch.attempt && patch.attempt !== task.value.attempt) logs.value = [];
  Object.assign(task.value, patch);
  if (wasLive && !live.value) {
    artifacts.value = (await tryApi(() => api<Artifact[]>(`/tasks/${id.value}/artifacts`))) ?? artifacts.value;
  }
});
useLiveEvent<TaskLog & { taskId: string }>('task:log', (log) => {
  if (log.taskId === id.value) logs.value.push(log);
});

async function resume() {
  await tryApi(() => api(`/tasks/${id.value}/resume`, { method: 'POST' }), 'Resumed');
}

// Takeover: pause the script, then drive the page from the live view.
const control = ref(false);
const pausing = ref(false);
async function pause() {
  pausing.value = true;
  const ok = await tryApi(() => api(`/tasks/${id.value}/pause`, { method: 'POST' }).then(() => true));
  if (!ok) pausing.value = false;
}
watch(
  () => task.value?.status,
  (status) => {
    if (status !== 'running') pausing.value = false;
    if (status !== 'paused') control.value = false;
  },
);
let lastInputError = 0;
function onInputError(message: string) {
  if (Date.now() - lastInputError < 3000) return;
  lastInputError = Date.now();
  ElMessage.warning(message);
}
async function cancel() {
  await tryApi(() => api(`/tasks/${id.value}/cancel`, { method: 'POST' }), 'Cancelling…');
}

/** Opens the script editor (or a new script for inline jobs) with the AI diagnosing this task. */
async function fixWithAi() {
  const job = await tryApi(() => api<{ scriptId?: string }>(`/jobs/${task.value!.jobId}`));
  if (!job) return;
  navigateTo({ path: `/scripts/${job.scriptId ?? 'new'}`, query: { aiFix: id.value } });
}

const formatSize = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
const images = computed(() => artifacts.value.filter((a) => a.mime.startsWith('image/')).map((a) => artifactUrl(a._id)));
</script>

<template>
  <div v-if="task" class="page">
    <PageHeader :title="task.name" :back="`/jobs/${task.jobId}`">
      <template #badge><StatusTag :status="task.status" /></template>
      <template #subtitle>Lần thử {{ task.attempt }}<span v-if="task.startedAt"> · bắt đầu {{ fmtDate(task.startedAt) }}</span></template>
      <template #actions>
        <el-button v-if="task.status === 'running'" :loading="pausing" @click="pause">
          {{ pausing ? 'Sẽ dừng sau bước này…' : '⏸ Tạm dừng' }}
        </el-button>
        <template v-if="task.status === 'paused'">
          <el-switch v-model="control" active-text="Điều khiển tay" class="mr-2" />
          <el-button type="success" @click="resume">▶ Resume</el-button>
        </template>
        <el-button v-if="live || task.status === 'queued'" type="warning" plain @click="cancel">Huỷ task</el-button>
        <el-button v-if="task.status === 'failed'" color="#7c3aed" @click="fixWithAi">✨ Nhờ AI sửa</el-button>
      </template>
    </PageHeader>

    <el-alert v-if="task.status === 'paused'" type="warning" :closable="false" show-icon :title="task.pauseMessage || 'Paused'"
      description="Bật “Điều khiển tay” để dùng chuột và bàn phím ngay trên màn hình live (hoặc thao tác trên cửa sổ Chrome nếu chạy headed), xong bấm Resume." />
    <el-alert v-if="task.error && task.status !== 'running'" type="error" :closable="false" show-icon
      :title="task.error.stepPath ? `Lỗi ở bước ${task.error.stepPath} (${task.error.actionType})` : 'Lỗi'"
      :description="task.error.message" />

    <div class="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <div class="space-y-4 xl:col-span-3">
        <el-card shadow="never" body-class="!p-2">
          <LiveFrame
            v-if="live"
            :task-id="task._id"
            quality="high"
            :interactive="control && task.status === 'paused'"
            @input-error="onInputError"
          />
          <div v-else-if="task.error?.screenshot" class="overflow-hidden rounded bg-gray-900">
            <img :src="artifactUrl(task.error.screenshot)" class="w-full" alt="error screenshot" />
          </div>
          <div v-else-if="images.length" class="overflow-hidden rounded bg-gray-900">
            <img :src="images.at(-1)" class="w-full" alt="last screenshot" />
          </div>
          <div v-else class="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg bg-slate-50 text-sm text-slate-500">
            <StatusTag :status="task.status" />
            <span v-if="task.status === 'done'">Không có ảnh chụp: xem kết quả bên dưới.</span>
          </div>
          <div class="mt-2 flex items-center gap-2 truncate px-1 text-xs text-slate-500" :title="task.currentUrl">
            <span v-if="live && task.currentStep" class="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-600">bước {{ task.currentStep }}</span>
            <span class="truncate">{{ task.currentUrl || '—' }}</span>
          </div>
        </el-card>

        <el-card shadow="never" header="Các bước" body-class="!p-0">
          <div class="h-80"><StepLog :logs="logs" /></div>
        </el-card>
      </div>

      <div class="space-y-4 xl:col-span-2">
        <el-card shadow="never" header="Biến đầu vào">
          <pre class="m-0 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-xs">{{ JSON.stringify(task.vars, null, 2) }}</pre>
        </el-card>

        <el-card shadow="never" :header="`Ảnh chụp & file (${artifacts.length})`">
          <el-empty v-if="!artifacts.length" :image-size="50" description="Chưa có" />
          <div v-for="a in artifacts" :key="a._id" class="mb-3 flex items-center gap-3">
            <el-image
              v-if="a.mime.startsWith('image/')"
              :src="artifactUrl(a._id)"
              :preview-src-list="images"
              :initial-index="images.indexOf(artifactUrl(a._id))"
              fit="cover"
              class="h-14 w-24 shrink-0 rounded border"
              preview-teleported
            />
            <div class="flex h-14 w-24 shrink-0 items-center justify-center rounded border text-xs uppercase text-gray-500" v-else>
              {{ a.kind }}
            </div>
            <div class="min-w-0 grow text-sm">
              <div class="truncate">{{ a.name }}</div>
              <div class="text-xs text-gray-400">{{ formatSize(a.size) }} · {{ fmtTime(a.createdAt) }}</div>
            </div>
            <a :href="artifactUrl(a._id, true)" class="text-sm">Tải về</a>
          </div>
        </el-card>
      </div>
    </div>

    <el-card shadow="never" header="Kết quả">
      <ResultView :result="task.result" />
    </el-card>
  </div>
</template>
