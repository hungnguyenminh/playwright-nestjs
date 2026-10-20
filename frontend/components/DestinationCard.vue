<script setup lang="ts">
import type { Destination, Profile } from '~/types/api';

/** One place to post and the accounts used there (part of DestinationsEditor). */
const d = defineModel<Destination>({ required: true });
const props = defineProps<{ index: number; profiles: Profile[] }>();
defineEmits<{ remove: [] }>();
const { api } = useApi();

function setKind(kind: Destination['kind']) {
  d.value = { ...d.value, kind, url: kind === 'self' ? '' : d.value.url, accountMode: kind === 'self' ? 'all' : 'rotate' };
  linkCheck.value = undefined;
}

// Live check of Facebook links (form only; no browser).
const linkCheck = ref<{ ok: boolean; text: string }>();
let timer: ReturnType<typeof setTimeout> | undefined;
function checkLink() {
  clearTimeout(timer);
  if (!d.value.url?.trim()) return (linkCheck.value = undefined);
  timer = setTimeout(async () => {
    const res = await api<{ kind?: string; url?: string; slug?: string; error?: string }>('/publish/parse-destination', { method: 'POST', body: { url: d.value.url } }).catch(() => null);
    if (!res) return;
    if (res.error) linkCheck.value = { ok: false, text: res.error };
    else if (res.kind !== d.value.kind) linkCheck.value = { ok: false, text: `Đây là link ${res.kind === 'group' ? 'Group' : 'Page'}` };
    else linkCheck.value = { ok: true, text: `${res.kind === 'group' ? 'Nhóm' : 'Page'} "${res.slug}" → ${res.url}` };
  }, 300);
}
onMounted(checkLink);

/** Read-only check of the Page / Group with every chosen profile. */
type CheckRow = { profileId: string; profileName: string; state: string; message: string; name?: string; taskId?: string };
const check = reactive({ busy: false, rows: [] as CheckRow[], name: '' });
async function checkWithProfiles() {
  if (!d.value.url?.trim() || !d.value.profileIds.length) return ElMessage.warning('Nhập link và chọn profile trước');
  check.busy = true;
  const res = await tryApi(() =>
    api<{ results: CheckRow[] }>('/publish/check-destination', { method: 'POST', body: { url: d.value.url, profileIds: d.value.profileIds } }),
  );
  check.busy = false;
  if (!res) return;
  check.rows = res.results;
  check.name = res.results.find((r) => r.name)?.name ?? '';
}
const CHECK_TAG: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  ok: 'success',
  pending: 'warning',
  not_member: 'danger',
  cannot_post: 'danger',
  needs_login: 'danger',
  not_found: 'danger',
  error: 'info',
};

const profileName = (id: string) => props.profiles.find((p) => p._id === id)?.name ?? '(đã xoá)';
const sick = computed(() => d.value.profileIds.filter((id) => !!props.profiles.find((p) => p._id === id)?.health?.needsLogin));
const strategy = computed({
  get: () => d.value.rotate?.strategy ?? 'roundRobin',
  set: (v) => (d.value.rotate = { ...d.value.rotate, strategy: v }),
});
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="flex items-center gap-2">
        <span class="font-semibold">{{ index + 1 }}. {{ destinationLabel(d) }}</span>
        <el-button class="!ml-auto" size="small" type="danger" plain @click="$emit('remove')">Xoá</el-button>
      </div>
    </template>
    <el-form label-position="top" @submit.prevent>
      <div v-if="d.platform === 'facebook'" class="flex flex-wrap items-start gap-4">
        <el-form-item label="Đăng vào">
          <el-radio-group :model-value="d.kind" @update:model-value="(v) => setKind(v as Destination['kind'])">
            <el-radio-button value="self">Trang cá nhân</el-radio-button>
            <el-radio-button value="page">Page</el-radio-button>
            <el-radio-button value="group">Nhóm</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="d.kind !== 'self'" :label="d.kind === 'group' ? 'Link nhóm' : 'Link Page'" class="min-w-80 flex-1">
          <el-input v-model="d.url" :placeholder="d.kind === 'group' ? 'https://www.facebook.com/groups/...' : 'https://www.facebook.com/ten-page'" @input="checkLink" />
          <div v-if="linkCheck" class="text-xs" :class="linkCheck.ok ? 'text-emerald-600' : 'text-red-600'">{{ linkCheck.ok ? '✓' : '✗' }} {{ linkCheck.text }}</div>
        </el-form-item>
      </div>

      <el-form-item label="Profile (tài khoản) dùng cho điểm đăng này">
        <el-select v-model="d.profileIds" multiple filterable placeholder="Chọn profile đã đăng nhập" class="w-full">
          <el-option v-for="p in profiles" :key="p._id" :value="p._id" :label="p.name">
            <span>{{ p.name }}</span>
            <el-tag v-if="p.health?.needsLogin" size="small" type="danger" class="ml-2">cần đăng nhập lại</el-tag>
            <span class="ml-2 text-xs text-slate-400">{{ p.mode === 'session' ? 'DB' : 'thư mục' }}</span>
          </el-option>
        </el-select>
        <div v-if="sick.length" class="text-xs text-amber-600">
          {{ sick.map(profileName).join(', ') }} đang cần đăng nhập lại: sẽ bị bỏ qua cho tới khi đăng nhập (trang Profiles).
        </div>
      </el-form-item>

      <div v-if="d.platform === 'facebook' && d.kind !== 'self'" class="mb-4">
        <el-button size="small" :loading="check.busy" @click="checkWithProfiles">🔍 Kiểm tra bằng profile</el-button>
        <span class="ml-2 text-xs text-slate-500">Mở {{ d.kind === 'group' ? 'nhóm' : 'Page' }} bằng từng profile (chỉ xem, không đăng): đã là thành viên chưa, có ô viết bài không.</span>
        <div v-if="check.rows.length" class="mt-2 rounded border border-slate-200 p-2 text-sm">
          <div v-if="check.name" class="mb-1 font-medium">{{ check.name }}</div>
          <div v-for="r in check.rows" :key="r.profileId" class="flex items-center gap-2 py-0.5">
            <span class="w-36 truncate">{{ r.profileName }}</span>
            <el-tag size="small" :type="CHECK_TAG[r.state] ?? 'info'">{{ r.message }}</el-tag>
            <NuxtLink v-if="r.taskId" :to="`/tasks/${r.taskId}`" target="_blank" class="text-xs">xem</NuxtLink>
          </div>
          <div v-if="check.rows.some((r) => r.state !== 'ok')" class="mt-1 text-xs text-amber-600">
            Profile chưa đạt sẽ không đăng được ở đây: bỏ khỏi danh sách, hoặc vào nhóm / đăng nhập lại rồi kiểm tra lại.
          </div>
        </div>
      </div>

      <el-form-item label="Cách đăng">
        <el-radio-group v-model="d.accountMode">
          <el-radio value="rotate">Xoay vòng: mỗi lượt chỉ 1 tài khoản, lần lượt đổi người</el-radio>
          <el-radio value="all">Tất cả cùng đăng (giãn cách giữa các tài khoản)</el-radio>
        </el-radio-group>
        <div v-if="d.kind !== 'self' && d.accountMode === 'all' && d.profileIds.length > 1" class="text-xs text-amber-600">
          Nhiều tài khoản cùng đăng vào một {{ d.kind === 'group' ? 'nhóm' : 'Page' }} mỗi lượt dễ bị coi là spam: nên chọn Xoay vòng.
        </div>
      </el-form-item>

      <div class="flex flex-wrap gap-x-6">
        <el-form-item v-if="d.accountMode === 'rotate'" label="Thứ tự xoay">
          <el-select v-model="strategy" class="!w-64">
            <el-option value="roundRobin" label="Lần lượt (A → B → C → A…)" />
            <el-option value="random" label="Ngẫu nhiên, không lặp trong 1 vòng" />
            <el-option value="leastRecent" label="Ai lâu chưa đăng nhất" />
          </el-select>
        </el-form-item>
        <el-form-item label="1 profile ở đây cách nhau (phút)">
          <el-input-number v-model="d.limits.minGapPerProfileMinutes" :min="0" :max="10080" :step="30" />
        </el-form-item>
        <el-form-item label="Tối đa bài / profile / ngày">
          <el-input-number v-model="d.limits.maxPerProfilePerDay" :min="1" :max="100" />
        </el-form-item>
        <el-form-item label="Không lặp 1 bài trong (ngày)">
          <el-input-number v-model="d.limits.noRepeatPostDays" :min="0" :max="3650" />
        </el-form-item>
      </div>
    </el-form>
  </el-card>
</template>
