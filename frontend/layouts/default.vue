<script setup lang="ts">
import {
  DataBoard,
  Download,
  Document,
  Expand,
  Fold,
  Guide,
  List,
  Promotion,
  QuestionFilled,
  Refresh,
  Setting,
  Tickets,
  User,
} from '@element-plus/icons-vue';
import { useLiveStore } from '~/stores/live';

const route = useRoute();
const live = useLiveStore();
useSocket();

const { isPhone, isTablet } = useBreakpoint();
/** Desktop/tablet: icon-only sidebar. Tablets start collapsed. */
const collapsed = useState('sidebar-collapsed', () => false);
/** Phone: the sidebar is an off-canvas drawer. */
const drawerOpen = ref(false);
watch(isTablet, (tablet) => (collapsed.value = tablet), { immediate: true });
watch(() => route.fullPath, () => (drawerOpen.value = false));
const mini = computed(() => !isPhone.value && collapsed.value);

function toggleMenu() {
  if (isPhone.value) drawerOpen.value = !drawerOpen.value;
  else collapsed.value = !collapsed.value;
}

const groups = [
  {
    title: 'Vận hành',
    items: [
      { to: '/', label: 'Dashboard', icon: DataBoard },
      { to: '/flows', label: 'Kéo dữ liệu', icon: Download },
      { to: '/publish', label: 'Đăng bài', icon: Promotion },
      { to: '/pipelines', label: 'Kéo → Đăng', icon: Refresh },
    ],
  },
  {
    title: 'Tài nguyên',
    items: [
      { to: '/profiles', label: 'Profiles', icon: User },
      { to: '/scripts', label: 'Scripts', icon: Document },
      { to: '/script-flows', label: 'Luồng script', icon: Guide },
    ],
  },
  {
    title: 'Hệ thống',
    items: [
      { to: '/jobs', label: 'Lịch sử chạy', icon: List },
      { to: '/activity', label: 'Nhật ký hoạt động', icon: Tickets },
      { to: '/settings', label: 'Cài đặt', icon: Setting },
      { to: '/guide', label: 'Hướng dẫn', icon: QuestionFilled },
    ],
  },
];
/** Pages that belong to a menu entry without sharing its path. */
const ALIAS: Array<[RegExp, string]> = [
  [/^\/data(\/|$)/, '/flows'],
  [/^\/tasks\//, '/jobs'],
];
const items = groups.flatMap((g) => g.items);

const active = computed(() => {
  const path = ALIAS.find(([re]) => re.test(route.path))?.[1] ?? route.path;
  // Longest prefix wins.
  const match = [...items]
    .sort((a, b) => b.to.length - a.to.length)
    .find((m) => (m.to === '/' ? path === '/' : path === m.to || path.startsWith(m.to + '/')));
  return match?.to ?? '/';
});
const section = computed(() => items.find((i) => i.to === active.value)?.label ?? '');
</script>

<template>
  <div class="flex h-full">
    <!-- sidebar -->
    <div v-if="isPhone && drawerOpen" class="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm" @click="drawerOpen = false" />
    <aside
      class="flex shrink-0 flex-col bg-[var(--sidebar-bg)] text-[var(--sidebar-fg)] transition-all duration-200"
      :class="
        isPhone
          ? ['fixed inset-y-0 left-0 z-50 w-[260px] shadow-2xl', drawerOpen ? 'translate-x-0' : '-translate-x-full']
          : mini
            ? 'w-[68px]'
            : 'w-[232px]'
      "
    >
      <NuxtLink to="/" class="flex h-16 items-center gap-3 px-4 text-white hover:text-white">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-lg shadow-indigo-900/40">
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M3 12h18" />
          </svg>
        </span>
        <span v-if="!mini" class="leading-tight">
          <span class="block text-[15px] font-semibold tracking-tight">Browser Automation</span>
          <span class="block text-[11px] text-slate-400">Chrome · Playwright</span>
        </span>
      </NuxtLink>

      <nav class="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        <div v-for="g in groups" :key="g.title">
          <div v-if="!mini" class="mb-1.5 px-3 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">{{ g.title }}</div>
          <div v-else class="mx-3 mb-2 border-t border-slate-800" />
          <NuxtLink
            v-for="m in g.items"
            :key="m.to"
            :to="m.to"
            :title="mini ? m.label : undefined"
            class="group relative mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors"
            :class="active === m.to ? 'bg-[var(--sidebar-active)] text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'"
          >
            <span v-if="active === m.to" class="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-indigo-400" />
            <el-icon :size="17" :class="active === m.to ? 'text-indigo-300' : ''"><component :is="m.icon" /></el-icon>
            <span v-if="!mini">{{ m.label }}</span>
          </NuxtLink>
        </div>
      </nav>

      <div class="border-t border-slate-800 p-3">
        <div class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs" :title="live.connected ? 'Đang nhận cập nhật realtime' : 'Mất kết nối tới backend'">
          <span class="relative flex h-2 w-2">
            <span v-if="live.connected" class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span class="relative inline-flex h-2 w-2 rounded-full" :class="live.connected ? 'bg-emerald-400' : 'bg-red-500'" />
          </span>
          <span v-if="!mini">{{ live.connected ? 'Đã kết nối realtime' : 'Mất kết nối backend' }}</span>
        </div>
      </div>
    </aside>

    <!-- main -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 bg-white/80 px-3 backdrop-blur sm:h-16 sm:px-6">
        <div class="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-slate-500 hover:bg-slate-100"
            :title="isPhone ? 'Menu' : collapsed ? 'Mở rộng menu' : 'Thu gọn menu'"
            @click="toggleMenu"
          >
            <el-icon :size="18"><component :is="isPhone || collapsed ? Expand : Fold" /></el-icon>
          </button>
          <span class="hidden text-sm text-slate-400 sm:inline">Browser Automation</span>
          <span class="hidden text-slate-300 sm:inline">/</span>
          <span class="truncate text-sm font-medium text-slate-700">{{ section }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span
            v-if="!live.connected"
            class="hidden rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 ring-1 ring-inset ring-red-200 md:inline"
          >
            Backend chưa chạy: chạy <code>npm run dev</code>
          </span>
          <el-button type="primary" @click="navigateTo('/flows/new')">+<span class="ml-1 hidden sm:inline">Tạo luồng</span></el-button>
        </div>
      </header>
      <main class="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6">
        <slot />
      </main>
    </div>
  </div>
</template>
