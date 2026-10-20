<script setup lang="ts">
import type { Media, Platform, PlatformInfo, PlatformOptions, Post, PostCheck, PostStatus } from '~/types/api';

/**
 * Create / edit a post: shared content and media on the left, per-platform
 * format and options on the right, checked live against each platform's rules.
 */
const props = defineProps<{ id?: string }>();
const { api } = useApi();

const PLATFORM_ICON: Record<Platform, string> = { facebook: '📘', youtube: '▶️', tiktok: '🎵', threads: '🧵' };

const infos = ref<PlatformInfo[]>([]);
const allTags = ref<string[]>([]);
const loaded = ref(!props.id);
const saving = ref(false);

const form = reactive({
  title: '',
  content: '',
  hashtags: [] as string[],
  link: '',
  tags: [] as string[],
  status: 'draft' as PostStatus,
  media: [] as Media[],
  platforms: {} as Partial<Record<Platform, PlatformOptions>>,
});
const origin = ref<Post['origin']>('manual');

const enabled = computed<Platform[]>({
  get: () => infos.value.map((i) => i.platform).filter((p) => form.platforms[p]),
  set: (list) => {
    const next: Partial<Record<Platform, PlatformOptions>> = {};
    for (const p of list) next[p] = form.platforms[p] ?? {};
    form.platforms = next;
    if (!list.includes(tab.value as Platform)) tab.value = list[0] ?? '';
  },
});
const tab = ref<string>('');

function body(status = form.status) {
  return {
    title: form.title.trim() || 'Bài chưa đặt tên',
    content: form.content,
    hashtags: form.hashtags,
    link: form.link.trim() || undefined,
    tags: form.tags,
    status,
    mediaIds: form.media.map((m) => m._id),
    platforms: form.platforms,
  };
}

// ---- live check -------------------------------------------------------------
const checks = ref<Partial<Record<Platform, PostCheck>>>({});
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => [form.content, form.hashtags, form.link, form.media, form.platforms, form.title],
  () => {
    clearTimeout(timer);
    timer = setTimeout(runCheck, 350);
  },
  { deep: true },
);
onBeforeUnmount(() => clearTimeout(timer));
async function runCheck() {
  if (!enabled.value.length) return (checks.value = {});
  checks.value = (await api<Partial<Record<Platform, PostCheck>>>('/posts/check', { method: 'POST', body: { post: body('draft') } }).catch(() => checks.value)) ?? {};
}
const errorCount = computed(() => Object.values(checks.value).reduce((n, c) => n + (c?.errors.length ?? 0), 0));

// ---- save ----------------------------------------------------------------------
async function save(status: PostStatus) {
  if (!form.title.trim()) return ElMessage.error('Đặt tên cho bài (tên nội bộ)');
  if (status === 'ready' && !enabled.value.length) return ElMessage.error('Chọn ít nhất một nền tảng');
  if (status === 'ready' && errorCount.value) return ElMessage.error('Bài còn lỗi ở một số nền tảng, xem phần kiểm tra bên phải');
  saving.value = true;
  const saved = await tryApi(
    () => (props.id ? api<Post>(`/posts/${props.id}`, { method: 'PUT', body: body(status) }) : api<Post>('/posts', { method: 'POST', body: body(status) })),
    status === 'ready' ? 'Đã lưu, bài sẵn sàng để đăng' : 'Đã lưu',
  );
  saving.value = false;
  if (!saved) return false;
  form.status = saved.status;
  if (!props.id) navigateTo(`/publish/posts/${saved._id}`, { replace: true });
  return true;
}

/** Saves the current edits, then opens "Đăng ngay" (needs a ready post) or "Đăng thử". */
const publishDialog = reactive({ open: false, mode: 'now' as 'now' | 'test' });
async function openPublish(mode: 'now' | 'test') {
  if (!(await save(mode === 'now' ? 'ready' : form.status === 'archived' ? 'draft' : form.status))) return;
  Object.assign(publishDialog, { open: true, mode });
}

async function remove() {
  const ok = await ElMessageBox.confirm('Xoá bài này? Media vẫn còn trong thư viện.', 'Xoá bài', { type: 'warning', confirmButtonText: 'Xoá' }).catch(() => false);
  if (ok && (await tryApi(() => api(`/posts/${props.id}`, { method: 'DELETE' }).then(() => true), 'Đã xoá'))) navigateTo('/publish/posts');
}
async function duplicate() {
  const copy = await tryApi(() => api<Post>(`/posts/${props.id}/duplicate`, { method: 'POST' }), 'Đã tạo bản sao');
  if (copy) navigateTo(`/publish/posts/${copy._id}`);
}

onMounted(async () => {
  const [i, t] = await Promise.all([tryApi(() => api<PlatformInfo[]>('/publish/platforms')), tryApi(() => api<string[]>('/posts/tags'))]);
  infos.value = i ?? [];
  allTags.value = t ?? [];
  if (!props.id) {
    enabled.value = ['facebook'];
    return;
  }
  const post = await tryApi(() => api<Post>(`/posts/${props.id}`));
  if (!post) return;
  Object.assign(form, {
    title: post.title,
    content: post.content,
    hashtags: post.hashtags,
    link: post.link ?? '',
    tags: post.tags,
    status: post.status,
    media: post.media,
    platforms: post.platforms ?? {},
  });
  origin.value = post.origin;
  checks.value = post.checks;
  tab.value = enabled.value[0] ?? '';
  loaded.value = true;
});

const STATUS_LABEL: Record<PostStatus, string> = { draft: 'Nháp', ready: 'Sẵn sàng đăng', archived: 'Lưu trữ' };
</script>

<template>
  <div v-if="loaded" class="grid grid-cols-1 gap-4 xl:grid-cols-5">
    <!-- shared content -->
    <el-card shadow="never" class="xl:col-span-3">
      <template #header>
        <div class="flex items-center gap-2">
          <span class="font-semibold">Nội dung chung</span>
          <el-tag size="small" :type="form.status === 'ready' ? 'success' : form.status === 'archived' ? 'info' : 'warning'">{{ STATUS_LABEL[form.status] }}</el-tag>
          <el-tag v-if="origin === 'ai'" size="small" type="primary">AI</el-tag>
        </div>
      </template>
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="Tên bài (nội bộ, không đăng lên)">
          <el-input v-model="form.title" placeholder="vd: Khai trương chi nhánh Cầu Giấy" maxlength="300" />
        </el-form-item>
        <el-form-item label="Nội dung">
          <el-input v-model="form.content" type="textarea" :autosize="{ minRows: 6, maxRows: 20 }" placeholder="Viết nội dung dùng chung cho mọi nền tảng; mỗi nền tảng có thể ghi đè ở bên phải." />
          <div class="text-xs text-slate-400">{{ form.content.length }} ký tự</div>
        </el-form-item>
        <div class="grid grid-cols-1 gap-x-4 md:grid-cols-2">
          <el-form-item label="Hashtag">
            <el-select v-model="form.hashtags" multiple filterable allow-create default-first-option :reserve-keyword="false" placeholder="Gõ rồi Enter, không cần #" />
          </el-form-item>
          <el-form-item label="Link kèm theo">
            <el-input v-model="form.link" placeholder="https://…" />
          </el-form-item>
        </div>
        <el-form-item label="Ảnh / video">
          <MediaPicker v-model="form.media" class="w-full" />
        </el-form-item>
        <el-form-item label="Nhãn (để lọc trong kho bài)">
          <el-select v-model="form.tags" multiple filterable allow-create default-first-option :reserve-keyword="false" placeholder="vd: khuyến mãi, tháng 10">
            <el-option v-for="t in allTags" :key="t" :value="t" :label="t" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- per platform -->
    <el-card shadow="never" class="xl:col-span-2">
      <template #header><span class="font-semibold">Đăng lên đâu</span></template>
      <el-checkbox-group v-model="enabled" class="mb-3 flex flex-wrap gap-x-4">
        <el-checkbox v-for="i in infos" :key="i.platform" :value="i.platform">
          {{ PLATFORM_ICON[i.platform] }} {{ i.label }}
          <span v-if="checks[i.platform]" class="ml-1 text-xs" :class="checks[i.platform]!.errors.length ? 'text-red-600' : 'text-emerald-600'">
            {{ checks[i.platform]!.errors.length ? `${checks[i.platform]!.errors.length} lỗi` : '✓' }}
          </span>
        </el-checkbox>
      </el-checkbox-group>
      <el-empty v-if="!enabled.length" description="Chọn ít nhất một nền tảng" :image-size="50" />
      <el-tabs v-else v-model="tab">
        <el-tab-pane v-for="p in enabled" :key="p" :name="p" :label="`${PLATFORM_ICON[p]} ${infos.find((i) => i.platform === p)?.label}`">
          <PlatformOptions
            v-model="form.platforms[p]!"
            :info="infos.find((i) => i.platform === p)!"
            :check="checks[p]"
            :media="form.media"
            :shared-content="form.content"
          />
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <div class="flex flex-wrap items-center gap-2 xl:col-span-5">
      <el-button :loading="saving" @click="save(form.status === 'archived' ? 'archived' : 'draft')">Lưu nháp</el-button>
      <el-button type="primary" :loading="saving" :disabled="!enabled.length" @click="save('ready')">Lưu &amp; sẵn sàng đăng</el-button>
      <span v-if="errorCount" class="text-sm text-red-600">Còn {{ errorCount }} lỗi, chưa thể chuyển sang "sẵn sàng".</span>
      <template v-if="id">
        <el-button :disabled="!enabled.length || !!errorCount" @click="openPublish('test')">Đăng thử</el-button>
        <el-button type="danger" plain :disabled="!enabled.length || !!errorCount" @click="openPublish('now')">⚡ Đăng ngay</el-button>
        <el-button class="!ml-auto" @click="duplicate">Nhân bản</el-button>
        <el-button v-if="form.status !== 'archived'" @click="save('archived')">Lưu trữ</el-button>
        <el-button type="danger" plain @click="remove">Xoá</el-button>
      </template>
    </div>
    <PublishNowDialog v-if="id" v-model="publishDialog.open" :post-id="id" :platforms="enabled" :mode="publishDialog.mode" />
  </div>
</template>
