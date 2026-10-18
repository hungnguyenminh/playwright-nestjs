<script setup lang="ts">
import { totalOf, type Totals } from '~/types/api';

const props = defineProps<{ totals: Totals; showCounts?: boolean }>();

const total = computed(() => totalOf(props.totals) || 1);
const finished = computed(() => props.totals.done + props.totals.failed + props.totals.cancelled);
const percent = computed(() => Math.round((finished.value / total.value) * 100));
const status = computed(() =>
  props.totals.failed ? 'exception' : finished.value === total.value ? 'success' : undefined,
);
</script>

<template>
  <div>
    <el-progress :percentage="percent" :status="status" :stroke-width="10" />
    <div v-if="props.showCounts" class="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
      <span>queued {{ props.totals.queued }}</span>
      <span class="text-blue-600">running {{ props.totals.running }}</span>
      <span v-if="props.totals.paused" class="font-medium text-amber-600">⏸ paused {{ props.totals.paused }} — waiting for Resume</span>
      <span class="text-green-600">done {{ props.totals.done }}</span>
      <span class="text-red-600">failed {{ props.totals.failed }}</span>
      <span>cancelled {{ props.totals.cancelled }}</span>
    </div>
  </div>
</template>
