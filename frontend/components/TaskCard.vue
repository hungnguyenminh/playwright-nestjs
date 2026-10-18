<script setup lang="ts">
import type { Task } from '~/types/api';

const props = defineProps<{ task: Task; newTab?: boolean }>();
const { api, artifactUrl } = useApi();

async function resume() {
  await tryApi(() => api<unknown>(`/tasks/${props.task._id}/resume`, { method: 'POST' }), 'Resumed');
}

const live = computed(() => props.task.status === 'running' || props.task.status === 'paused');
/** "posts: 28 mục", "title: Shop"… one line per result variable. */
const resultPreview = computed(() => {
  const r = props.task.result;
  if (!r) return [];
  return Object.entries(r)
    .slice(0, 5)
    .map(([k, v]) => {
      if (Array.isArray(v)) return { k, v: `${v.length} mục` };
      if (v && typeof v === 'object') return { k, v: `${Object.keys(v).length} trường` };
      return { k, v: String(v).slice(0, 60) };
    });
});
</script>

<template>
  <NuxtLink :to="`/tasks/${props.task._id}`" :target="props.newTab ? '_blank' : undefined" class="block text-inherit">
    <el-card shadow="never" body-class="!p-2.5" class="transition hover:-translate-y-0.5 hover:!border-indigo-200 hover:shadow-md">
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="truncate text-sm font-medium" :title="props.task.name">{{ props.task.name }}</span>
        <StatusTag :status="props.task.status" />
      </div>

      <LiveFrame v-if="live" :task-id="props.task._id" quality="low" />
      <div
        v-else-if="props.task.error?.screenshot"
        class="flex aspect-video items-center justify-center overflow-hidden rounded bg-gray-900"
      >
        <img :src="artifactUrl(props.task.error.screenshot)" class="h-full w-full object-contain opacity-80" alt="error" />
      </div>
      <div v-else class="flex aspect-video items-center justify-center rounded bg-gray-100 p-2 text-xs text-gray-500">
        <div v-if="props.task.status === 'done' && resultPreview.length" class="w-full space-y-1 self-start">
          <div class="eyebrow mb-1">Kết quả</div>
          <div v-for="r in resultPreview" :key="r.k" class="flex justify-between gap-2 rounded bg-white px-2 py-1">
            <span class="truncate font-medium text-slate-600">{{ r.k }}</span>
            <span class="truncate text-slate-500">{{ r.v }}</span>
          </div>
        </div>
        <StatusTag v-else :status="props.task.status" />
      </div>

      <div class="mt-2 space-y-0.5 text-xs text-gray-500">
        <div v-if="props.task.status === 'paused'" class="flex items-center justify-between gap-2 text-amber-600">
          <span class="truncate" :title="props.task.pauseMessage ?? ''">⏸ {{ props.task.pauseMessage }}</span>
          <el-button size="small" type="success" @click.prevent.stop="resume">Resume</el-button>
        </div>
        <div v-else-if="props.task.error" class="truncate text-red-600" :title="props.task.error.message">
          <span v-if="props.task.error.stepPath">step {{ props.task.error.stepPath }}: </span>{{ props.task.error.message }}
        </div>
        <div v-else-if="live && props.task.currentStep">step {{ props.task.currentStep }}</div>
        <div class="truncate" :title="props.task.currentUrl">{{ props.task.currentUrl || '—' }}</div>
      </div>
    </el-card>
  </NuxtLink>
</template>
