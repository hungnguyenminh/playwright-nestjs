<script setup lang="ts">
/** Tabs of the "Đăng bài" section; each tab is its own route. */
const route = useRoute();
const TABS = [
  { to: '/publish', label: 'Tổng quan' },
  { to: '/publish/posts', label: 'Bài viết' },
  { to: '/publish/campaigns', label: 'Lịch đăng' },
  { to: '/publish/selectors', label: 'Bộ đăng' },
];
/** Longest matching prefix wins (/publish/posts beats /publish). */
const active = computed(() => [...TABS].reverse().find((t) => route.path === t.to || route.path.startsWith(`${t.to}/`))?.to ?? '/publish');
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
