<script setup lang="ts">
import type { Job, Paged, Platform, Profile } from '~/types/api';

/**
 * Publish one saved post now, or rehearse it ("Đăng thử": compose on the site
 * and stop before "Post"), choosing where and with which account.
 */
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ postId: string; platforms: Platform[]; mode: 'now' | 'test' }>();
const { api } = useApi();

const profiles = ref<Profile[]>([]);
const targets = ref<Array<{ platform: Platform; kind: 'self' | 'page' | 'group'; url: string; profileId: string }>>([]);
const headless = ref(false);
const busy = ref(false);

watch(open, async (v) => {
  if (!v) return;
  if (!profiles.value.length) profiles.value = (await tryApi(() => api<Profile[]>('/profiles'))) ?? [];
  const first = profiles.value.find((p) => !p.health?.needsLogin)?._id ?? '';
  targets.value = props.platforms.slice(0, props.mode === 'test' ? 1 : undefined).map((platform) => ({ platform, kind: 'self', url: '', profileId: first }));
  headless.value = props.mode === 'now';
});

const add = () => targets.value.push({ platform: props.platforms[0] ?? 'facebook', kind: 'self', url: '', profileId: profiles.value[0]?._id ?? '' });

async function submit() {
  if (!targets.value.length || targets.value.some((t) => !t.profileId)) return ElMessage.warning('Chọn tài khoản cho mỗi nơi đăng');
  if (targets.value.some((t) => t.kind !== 'self' && !t.url.trim())) return ElMessage.warning('Nhập link Page / nhóm');
  busy.value = true;
  if (props.mode === 'test') {
    const t = targets.value[0];
    const job = await tryApi(() => api<Job>('/publish/test', { method: 'POST', body: { postId: props.postId, target: { ...t, url: t.url || undefined }, headless: headless.value } }));
    busy.value = false;
    if (!job) return;
    const task = (await api<Paged<{ _id: string }>>(`/jobs/${job._id}/tasks`)).items[0];
    open.value = false;
    navigateTo(`/tasks/${task._id}`);
    return;
  }
  const c = await tryApi(
    () => api<{ _id: string }>('/publish/now', { method: 'POST', body: { postId: props.postId, headless: headless.value, targets: targets.value.map((t) => ({ ...t, url: t.url || undefined })) } }),
    'Đã bắt đầu đăng',
  );
  busy.value = false;
  if (c) {
    open.value = false;
    navigateTo(`/publish/campaigns/${c._id}`);
  }
}
</script>

<template>
  <el-dialog v-model="open" :title="mode === 'test' ? 'Đăng thử (không đăng thật)' : '⚡ Đăng ngay'" width="760px">
    <el-alert
      v-if="mode === 'test'"
      type="info"
      :closable="false"
      show-icon
      title="Tool mở trang bằng tài khoản đã chọn, soạn bài, chụp ảnh rồi DỪNG trước nút Đăng. Xem trên trang task, bấm Resume để huỷ bản nháp."
      class="mb-3"
    />
    <el-alert v-else type="warning" :closable="false" show-icon title="Bài sẽ được đăng thật lên các nơi dưới đây, ngay bây giờ." class="mb-3" />

    <div v-for="(t, i) in targets" :key="i" class="mb-2 flex flex-wrap items-center gap-2">
      <el-select v-model="t.platform" class="!w-32">
        <el-option v-for="p in platforms" :key="p" :value="p" :label="`${PLATFORM_ICON[p]} ${PLATFORM_LABEL[p]}`" />
      </el-select>
      <el-select v-if="t.platform === 'facebook'" v-model="t.kind" class="!w-36">
        <el-option value="self" label="Trang cá nhân" />
        <el-option value="page" label="Page" />
        <el-option value="group" label="Nhóm" />
      </el-select>
      <el-input v-if="t.kind !== 'self'" v-model="t.url" placeholder="Link Page / nhóm" class="!w-60" />
      <el-select v-model="t.profileId" placeholder="Tài khoản (profile)" class="!w-44">
        <el-option v-for="p in profiles" :key="p._id" :value="p._id" :label="p.name" :disabled="!!p.health?.needsLogin" />
      </el-select>
      <el-button v-if="mode === 'now'" link type="danger" @click="targets.splice(i, 1)">Xoá</el-button>
    </div>
    <el-button v-if="mode === 'now'" size="small" @click="add">+ Thêm nơi đăng</el-button>

    <div class="mt-3">
      <el-checkbox :model-value="!headless" @update:model-value="(v) => (headless = !v)">Hiện cửa sổ Chrome để xem</el-checkbox>
    </div>
    <template #footer>
      <el-button @click="open = false">Huỷ</el-button>
      <el-button :type="mode === 'test' ? 'primary' : 'danger'" :loading="busy" :disabled="!targets.length" @click="submit">
        {{ mode === 'test' ? 'Đăng thử' : 'Đăng thật ngay' }}
      </el-button>
    </template>
  </el-dialog>
</template>
