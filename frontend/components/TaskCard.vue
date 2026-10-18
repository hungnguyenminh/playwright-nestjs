<script setup lang="ts">
import type { Task } from '~/types/api';

const props = defineProps<{ task: Task }>();
const { api, artifactUrl } = useApi();

async function resume() {
  await tryApi(() => api(`/tasks/${props.task._id}/resume`, { method: 'POST' }), 'Resumed');
}

const live = computed(() => props.task.status === 'running' || props.task.status === 'paused');
const resultPreview = computed(() => {
  const r = props.task.result;
  if (!r || !Object.keys(r).length) return '';
  return JSON.stringify(r).slice(0, 160);
});
</script>

<template>
  <NuxtLink :to="`/tasks/${props.task._id}`" class="block text-inherit">
    <el-card shadow="hover" body-class="!p-2">
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
        <span v-if="props.task.status === 'done'" class="line-clamp-5 break-all font-mono">{{ resultPreview || 'done' }}</span>
        <span v-else>{{ props.task.status }}</span>
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
