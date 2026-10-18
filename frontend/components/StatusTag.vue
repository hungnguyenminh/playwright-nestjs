<script setup lang="ts">
import type { JobStatus, StepStatus, TaskStatus } from '~/types/api';

const props = defineProps<{ status: JobStatus | TaskStatus | StepStatus }>();

const TYPES: Record<string, 'primary' | 'success' | 'warning' | 'danger' | 'info'> = {
  queued: 'info',
  running: 'primary',
  paused: 'warning',
  done: 'success',
  ok: 'success',
  failed: 'danger',
  error: 'danger',
  cancelled: 'info',
  skipped: 'warning',
};
</script>

<template>
  <el-tag :type="TYPES[props.status] ?? 'info'" size="small" effect="light" disable-transitions>
    <span v-if="props.status === 'running'" class="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle" />
    {{ props.status }}
  </el-tag>
</template>
