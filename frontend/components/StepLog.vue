<script setup lang="ts">
import type { TaskLog } from '~/types/api';

const props = defineProps<{ logs: TaskLog[] }>();

const box = ref<HTMLElement>();
const follow = ref(true);

const COLORS: Record<string, string> = {
  ok: 'text-green-500',
  error: 'text-red-500',
  skipped: 'text-amber-500',
};

function onScroll() {
  const el = box.value!;
  follow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
}

watch(
  () => props.logs.length,
  async () => {
    if (!follow.value) return;
    await nextTick();
    box.value?.scrollTo({ top: box.value.scrollHeight });
  },
  { immediate: true },
);
</script>

<template>
  <div
    ref="box"
    class="h-full overflow-auto rounded bg-gray-950 p-2 font-mono text-xs leading-5 text-gray-200"
    @scroll="onScroll"
  >
    <div v-if="!props.logs.length" class="text-gray-500">No steps yet.</div>
    <div v-for="(l, i) in props.logs" :key="l._id ?? i" class="flex gap-2 whitespace-pre-wrap break-all">
      <span class="shrink-0 text-gray-500">{{ new Date(l.ts).toLocaleTimeString() }}</span>
      <span class="w-14 shrink-0" :class="COLORS[l.status]">{{ l.status }}</span>
      <span class="w-28 shrink-0 truncate text-gray-400" :title="l.path">{{ l.path }}</span>
      <span class="shrink-0 text-sky-300">{{ l.type }}</span>
      <span v-if="l.label" class="shrink-0 text-violet-300">[{{ l.label }}]</span>
      <span class="grow" :class="l.status === 'error' ? 'text-red-300' : ''">{{ l.message }}</span>
      <span class="shrink-0 text-gray-500">{{ l.durationMs }}ms</span>
    </div>
  </div>
</template>
