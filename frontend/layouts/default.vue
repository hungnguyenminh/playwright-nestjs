<script setup lang="ts">
import { Connection, DataBoard, Document, List, Plus, User } from '@element-plus/icons-vue';
import { useLiveStore } from '~/stores/live';

const route = useRoute();
const live = useLiveStore();
useSocket();

const menu = [
  { to: '/', label: 'Dashboard', icon: DataBoard },
  { to: '/jobs', label: 'Jobs', icon: List },
  { to: '/jobs/new', label: 'New job', icon: Plus },
  { to: '/scripts', label: 'Scripts', icon: Document },
  { to: '/profiles', label: 'Profiles', icon: User },
];

const active = computed(() => {
  const path = route.path.startsWith('/tasks/') ? '/jobs' : route.path;
  // Longest prefix wins, so /jobs/new beats /jobs.
  const match = [...menu]
    .sort((a, b) => b.to.length - a.to.length)
    .find((m) => (m.to === '/' ? path === '/' : path === m.to || path.startsWith(m.to + '/')));
  return match?.to ?? '/';
});
</script>

<template>
  <el-container class="h-full">
    <el-aside width="200px" class="border-r border-gray-200 bg-white">
      <div class="flex h-14 items-center gap-2 px-5 font-semibold">
        <el-icon :size="20" class="text-blue-600"><Connection /></el-icon>
        Automation
      </div>
      <el-menu :default-active="active" router class="!border-r-0">
        <el-menu-item v-for="m in menu" :key="m.to" :index="m.to">
          <el-icon><component :is="m.icon" /></el-icon>
          <span>{{ m.label }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="flex items-center justify-end border-b border-gray-200 bg-white" height="56px">
        <span class="flex items-center gap-2 text-xs text-gray-500">
          <span class="h-2 w-2 rounded-full" :class="live.connected ? 'bg-green-500' : 'bg-red-500'" />
          {{ live.connected ? 'Live connected' : 'Disconnected' }}
        </span>
      </el-header>
      <el-main class="!p-5">
        <slot />
      </el-main>
    </el-container>
  </el-container>
</template>
