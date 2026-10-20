<script setup lang="ts">
/** Tabs of the "Kéo dữ liệu" section; each tab is its own route. */
const route = useRoute();
const TABS = [
  { to: '/flows', label: 'Luồng kéo dữ liệu' },
  { to: '/data', label: 'Dữ liệu đã lấy' },
];
const active = computed(() => (route.path.startsWith('/data') ? '/data' : '/flows'));
</script>

<template>
  <div class="flex gap-1 border-b border-slate-200">
    <NuxtLink
      v-for="t in TABS"
      :key="t.to"
      :to="t.to"
      class="-mb-px border-b-2 px-4 py-2 text-sm no-underline"
      :class="active === t.to ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-slate-600 hover:text-slate-900'"
    >
      {{ t.label }}
    </NuxtLink>
  </div>
</template>
