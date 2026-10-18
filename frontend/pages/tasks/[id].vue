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

const resultText = computed(() => JSON.stringify(task.value?.result ?? {}, null, 2));
const formatSize = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
const images = computed(() => artifacts.value.filter((a) => a.mime.startsWith('image/')).map((a) => artifactUrl(a._id)));
</script>

<template>
  <div v-if="task" class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <el-button text @click="navigateTo(`/jobs/${task.jobId}`)">←</el-button>
        <h1 class="m-0 text-xl font-semibold">{{ task.name }}</h1>
        <StatusTag :status="task.status" />
        <span class="text-sm text-gray-500">attempt {{ task.attempt }}</span>
      </div>
      <div class="flex gap-2">
        <el-button v-if="task.status === 'running'" :loading="pausing" @click="pause">
          {{ pausing ? 'Pausing after this step…' : 'Pause' }}
        </el-button>
        <template v-if="task.status === 'paused'">
          <el-switch v-model="control" active-text="Take control" class="mr-2" />
          <el-button type="success" @click="resume">Resume</el-button>
        </template>
        <el-button v-if="live || task.status === 'queued'" type="warning" @click="cancel">Cancel task</el-button>
      </div>
    </div>

    <el-alert v-if="task.status === 'paused'" type="warning" :closable="false" show-icon :title="task.pauseMessage || 'Paused'"
      description="Turn on “Take control” to use mouse and keyboard on the live view (or use the Chrome window in headed mode), then press Resume." />
    <el-alert v-if="task.error && task.status !== 'running'" type="error" :closable="false" show-icon
      :title="task.error.stepPath ? `Failed at step ${task.error.stepPath} (${task.error.actionType})` : 'Failed'"
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
          <div v-else class="flex aspect-video items-center justify-center rounded bg-gray-100 text-sm text-gray-500">
            Task is {{ task.status }}
          </div>
          <div class="mt-2 truncate px-1 text-xs text-gray-500" :title="task.currentUrl">
            <span v-if="live && task.currentStep" class="mr-2 text-blue-600">step {{ task.currentStep }}</span>{{ task.currentUrl || '—' }}
          </div>
        </el-card>

        <el-card shadow="never" header="Steps" body-class="!p-0">
          <div class="h-80"><StepLog :logs="logs" /></div>
        </el-card>
      </div>

      <div class="space-y-4 xl:col-span-2">
        <el-card shadow="never" header="Result">
          <pre class="m-0 max-h-96 overflow-auto rounded bg-gray-50 p-2 text-xs">{{ resultText }}</pre>
        </el-card>

        <el-card shadow="never" header="Variables">
          <pre class="m-0 max-h-48 overflow-auto rounded bg-gray-50 p-2 text-xs">{{ JSON.stringify(task.vars, null, 2) }}</pre>
        </el-card>

        <el-card shadow="never" :header="`Artifacts (${artifacts.length})`">
          <el-empty v-if="!artifacts.length" :image-size="50" description="None" />
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
              <div class="text-xs text-gray-400">{{ formatSize(a.size) }} · {{ new Date(a.createdAt).toLocaleTimeString() }}</div>
            </div>
            <a :href="artifactUrl(a._id, true)" class="text-sm">Download</a>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>
