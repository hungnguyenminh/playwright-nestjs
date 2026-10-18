<script setup lang="ts">
import type { JobStatus, StepStatus, TaskStatus } from '~/types/api';

const props = defineProps<{ status: JobStatus | TaskStatus | StepStatus }>();

/** Soft pill with a coloured dot; Vietnamese label. */
const STYLES: Record<string, { label: string; cls: string; dot: string }> = {
  queued: { label: 'Đang chờ', cls: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400' },
  running: { label: 'Đang chạy', cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200', dot: 'bg-indigo-500 animate-pulse' },
  paused: { label: 'Tạm dừng', cls: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  done: { label: 'Hoàn tất', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  ok: { label: 'OK', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  failed: { label: 'Lỗi', cls: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500' },
  error: { label: 'Lỗi', cls: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500' },
  cancelled: { label: 'Đã huỷ', cls: 'bg-slate-100 text-slate-500 ring-slate-200', dot: 'bg-slate-300' },
  skipped: { label: 'Bỏ qua', cls: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-400' },
};
const style = computed(() => STYLES[props.status] ?? { label: props.status, cls: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400' });
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
    :class="style.cls"
    :data-status="props.status"
  >
    <span class="h-1.5 w-1.5 rounded-full" :class="style.dot" />
    {{ style.label }}
  </span>
</template>
