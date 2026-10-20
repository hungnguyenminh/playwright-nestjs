<script setup lang="ts">
import type { Paged, Platform, Post, PostStatus, Profile, Publication } from '~/types/api';

/** Overview: what's coming up, what failed lately, and "publish now". */
const { api } = useApi();
const counts = reactive<Record<PostStatus, number>>({ draft: 0, ready: 0, archived: 0 });
const upcoming = ref<Publication[]>([]);
const failed = ref<Publication[]>([]);
const filter = reactive({ platform: '' as Platform | '', profileId: '' });
const profiles = ref<Profile[]>([]);
const readyPosts = ref<Post[]>([]);

async function loadUpcoming() {
  const query: Record<string, string> = { from: new Date(Date.now() - 3_600_000).toISOString() };
  if (filter.platform) query.platform = filter.platform;
  if (filter.profileId) query.profileId = filter.profileId;
  const res = await tryApi(() => api<{ items: Publication[]; failed: Publication[] }>('/publish/upcoming', { query }));
  upcoming.value = res?.items ?? [];
  failed.value = res?.failed ?? [];
}
onMounted(async () => {
  const [d, r, a, p] = await Promise.all([
    ...(['draft', 'ready', 'archived'] as const).map((status) => tryApi(() => api<Paged<Post>>('/posts', { query: { status, limit: status === 'ready' ? 200 : 1 } }))),
    tryApi(() => api<Profile[]>('/profiles')),
  ]);
  counts.draft = (d as Paged<Post> | undefined)?.total ?? 0;
  counts.ready = (r as Paged<Post> | undefined)?.total ?? 0;
  counts.archived = (a as Paged<Post> | undefined)?.total ?? 0;
  readyPosts.value = (r as Paged<Post> | undefined)?.items ?? [];
  profiles.value = (p as Profile[] | undefined) ?? [];
  loadUpcoming();
});
watch(filter, loadUpcoming);
useLiveRoom('subscribe:jobs', {});
let timer: ReturnType<typeof setTimeout> | undefined;
useLiveEvent('publication:update', () => {
  clearTimeout(timer);
  timer = setTimeout(loadUpcoming, 600);
});

// ---- publish now ---------------------------------------------------------------------
const now = reactive({
  open: false,
  postId: '',
  targets: [] as Array<{ platform: Platform; kind: 'self' | 'page' | 'group'; url: string; profileId: string }>,
  saving: false,
});
const nowPost = computed(() => readyPosts.value.find((p) => p._id === now.postId));
function openNow() {
  Object.assign(now, { open: true, postId: readyPosts.value[0]?._id ?? '', targets: [] });
}
function addTarget() {
  const platform = (Object.keys(nowPost.value?.checks ?? {})[0] as Platform) ?? 'facebook';
  now.targets.push({ platform, kind: 'self', url: '', profileId: profiles.value[0]?._id ?? '' });
}
async function publishNow() {
  if (!now.postId || !now.targets.length) return ElMessage.warning('Chọn bài và ít nhất một nơi đăng');
  now.saving = true;
  const c = await tryApi(
    () => api<{ _id: string }>('/publish/now', { method: 'POST', body: { postId: now.postId, targets: now.targets.map((t) => ({ ...t, url: t.url || undefined })) } }),
    'Đã bắt đầu đăng',
  );
  now.saving = false;
  if (c) navigateTo(`/publish/campaigns/${c._id}`);
}
</script>

<template>
  <div class="page">
    <PageHeader title="Đăng bài" subtitle="Soạn bài một lần, đăng lên Facebook, YouTube, TikTok, Threads bằng profile của bạn.">
      <template #actions>
        <el-button @click="openNow">⚡ Đăng ngay</el-button>
        <el-button @click="navigateTo('/publish/campaigns/new')">+ Lịch đăng</el-button>
        <el-button type="primary" @click="navigateTo('/publish/posts/new')">+ Bài viết mới</el-button>
      </template>
    </PageHeader>
    <PublishTabs />

    <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
      <el-card v-for="s in (['ready', 'draft', 'archived'] as const)" :key="s" shadow="never" class="cursor-pointer" @click="navigateTo({ path: '/publish/posts', query: { status: s } })">
        <div class="eyebrow">{{ s === 'ready' ? 'Bài sẵn sàng đăng' : s === 'draft' ? 'Bài nháp chờ duyệt' : 'Bài lưu trữ' }}</div>
        <div class="mt-1 text-3xl font-semibold">{{ counts[s] }}</div>
      </el-card>
    </div>

    <el-card shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-semibold">Sắp đăng (7 ngày tới)</span>
          <el-select v-model="filter.platform" clearable placeholder="Mọi nền tảng" size="small" class="!w-40">
            <el-option v-for="(l, p) in PLATFORM_LABEL" :key="p" :value="p" :label="`${PLATFORM_ICON[p]} ${l}`" />
          </el-select>
          <el-select v-model="filter.profileId" clearable placeholder="Mọi tài khoản" size="small" class="!w-44">
            <el-option v-for="p in profiles" :key="p._id" :value="p._id" :label="p.name" />
          </el-select>
        </div>
      </template>
      <PublicationTimeline :items="upcoming.filter((p) => ['scheduled', 'waiting', 'running'].includes(p.status))" show-campaign compact @changed="loadUpcoming" />
    </el-card>

    <el-card v-if="failed.length" shadow="never" header="Đăng lỗi gần đây (7 ngày)">
      <PublicationTimeline :items="failed" show-campaign @changed="loadUpcoming" />
    </el-card>

    <el-dialog v-model="now.open" title="Đăng ngay" width="720px">
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="Bài (chỉ bài Sẵn sàng)">
          <el-select v-model="now.postId" filterable class="w-full">
            <el-option v-for="p in readyPosts" :key="p._id" :value="p._id" :label="p.title">
              <span>{{ p.title }}</span>
              <span class="ml-2 text-xs text-slate-400">{{ Object.keys(p.checks).map((k) => PLATFORM_LABEL[k as Platform]).join(', ') }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <div class="mb-2 text-sm text-slate-600">Đăng lên (mỗi dòng một nơi, bằng một tài khoản):</div>
        <div v-for="(t, i) in now.targets" :key="i" class="mb-2 flex flex-wrap items-center gap-2">
          <el-select v-model="t.platform" class="!w-32">
            <el-option v-for="(l, p) in PLATFORM_LABEL" :key="p" :value="p" :label="l" :disabled="!nowPost?.checks[p]" />
          </el-select>
          <el-select v-if="t.platform === 'facebook'" v-model="t.kind" class="!w-36">
            <el-option value="self" label="Trang cá nhân" />
            <el-option value="page" label="Page" />
            <el-option value="group" label="Nhóm" />
          </el-select>
          <el-input v-if="t.kind !== 'self'" v-model="t.url" placeholder="Link Page / nhóm" class="!w-60" />
          <el-select v-model="t.profileId" placeholder="Tài khoản" class="!w-40">
            <el-option v-for="p in profiles" :key="p._id" :value="p._id" :label="p.name" />
          </el-select>
          <el-button link type="danger" @click="now.targets.splice(i, 1)">Xoá</el-button>
        </div>
        <el-button size="small" :disabled="!now.postId" @click="addTarget">+ Thêm nơi đăng</el-button>
      </el-form>
      <template #footer>
        <el-button @click="now.open = false">Huỷ</el-button>
        <el-button type="primary" :loading="now.saving" :disabled="!now.targets.length" @click="publishNow">Đăng</el-button>
      </template>
    </el-dialog>
  </div>
</template>
