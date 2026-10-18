<script setup lang="ts">
import { totalOf, type Totals } from '~/types/api';

const props = defineProps<{ totals: Totals; showCounts?: boolean }>();

const total = computed(() => totalOf(props.totals) || 1);
const finished = computed(() => props.totals.done + props.totals.failed + props.totals.cancelled);
const percent = computed(() => Math.round((finished.value / total.value) * 100));
/** Stacked bar segments, as % of all tasks. */
const segments = computed(() => [
  { cls: 'bg-emerald-500', w: (props.totals.done / total.value) * 100 },
  { cls: 'bg-red-500', w: (props.totals.failed / total.value) * 100 },
  { cls: 'bg-slate-300', w: (props.totals.cancelled / total.value) * 100 },
  { cls: 'bg-indigo-400 animate-pulse', w: ((props.totals.running + props.totals.paused) / total.value) * 100 },
]);
const counts = computed(() =>
  [
    { n: props.totals.running, label: 'đang chạy', cls: 'text-indigo-600' },
    { n: props.totals.queued, label: 'chờ', cls: 'text-slate-500' },
    { n: props.totals.done, label: 'xong', cls: 'text-emerald-600' },
    { n: props.totals.failed, label: 'lỗi', cls: 'text-red-600' },
    { n: props.totals.cancelled, label: 'huỷ', cls: 'text-slate-400' },
  ].filter((c) => c.n > 0),
);
</script>

<template>
  <div>
    <div class="flex items-center gap-3">
      <div class="flex h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div v-for="(s, i) in segments" :key="i" :class="s.cls" :style="{ width: `${s.w}%` }" />
      </div>
      <span class="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-slate-600">{{ percent }}%</span>
    </div>
    <div v-if="props.showCounts" class="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      <span v-for="c in counts" :key="c.label" :class="c.cls"><b class="tabular-nums">{{ c.n }}</b> {{ c.label }}</span>
      <span v-if="props.totals.paused" class="font-medium text-amber-600">⏸ {{ props.totals.paused }} tạm dừng: chờ Resume</span>
    </div>
  </div>
</template>
