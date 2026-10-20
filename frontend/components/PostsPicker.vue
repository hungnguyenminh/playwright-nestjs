<script setup lang="ts">
import type { CampaignForm, Paged, Post, Profile } from '~/types/api';

/** Which posts a campaign uses, in which order, and how accounts share them. */
const form = defineModel<CampaignForm>({ required: true });
const props = defineProps<{ profiles: Profile[] }>();
const { api } = useApi();

const library = ref<Post[]>([]);
onMounted(async () => {
  library.value = (await tryApi(() => api<Paged<Post>>('/posts', { query: { status: 'ready,draft', limit: 200 } })))?.items ?? [];
});
const byId = (id: string) => library.value.find((p) => p._id === id);

const list = computed<string[]>({
  get: () => (form.value.postSource.type === 'list' ? form.value.postSource.postIds : []),
  set: (ids) => {
    const separate = form.value.postSource.type === 'list' ? form.value.postSource.separate : undefined;
    form.value.postSource = { type: 'list', postIds: ids, ...(separate ? { separate } : {}) };
  },
});
function move(i: number, d: number) {
  const ids = [...list.value];
  const [x] = ids.splice(i, 1);
  ids.splice(i + d, 0, x);
  list.value = ids;
}

/** Accounts of "everyone posts" destinations (they get their own lists with 'separate'). */
const allAccounts = computed(() => [...new Set(form.value.destinations.filter((d) => d.accountMode === 'all').flatMap((d) => d.profileIds))]);
function separateFor(id: string) {
  return form.value.postSource.type === 'list' ? (form.value.postSource.separate?.[id] ?? []) : [];
}
function setSeparate(id: string, ids: string[]) {
  if (form.value.postSource.type !== 'list') return;
  form.value.postSource = { ...form.value.postSource, separate: { ...form.value.postSource.separate, [id]: ids } };
}
const platformsUsed = computed(() => [...new Set(form.value.destinations.map((d) => d.platform))]);
const problems = (p: Post) => platformsUsed.value.flatMap((pl) => (p.checks[pl] ? p.checks[pl]!.errors.map((e) => `${PLATFORM_LABEL[pl]}: ${e}`) : [`chưa chọn đăng lên ${PLATFORM_LABEL[pl]}`]));
const name = (id: string) => props.profiles.find((p) => p._id === id)?.name ?? id;
</script>

<template>
  <div class="space-y-4">
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="Kho bài (theo thứ tự đăng)">
        <el-select v-model="list" multiple filterable placeholder="Chọn bài từ kho bài viết" class="w-full">
          <el-option v-for="p in library" :key="p._id" :value="p._id" :label="p.title">
            <span>{{ p.title }}</span>
            <el-tag v-if="p.status !== 'ready'" size="small" type="warning" class="ml-2">nháp</el-tag>
            <el-tag v-if="problems(p).length" size="small" type="danger" class="ml-2">{{ problems(p).length }} lỗi</el-tag>
          </el-option>
        </el-select>
        <div class="text-xs text-slate-500">
          Chỉ bài <b>Sẵn sàng</b> mới được đăng; bài được chốt lúc tới lượt, nên sửa bài trong kho vẫn có hiệu lực.
          <NuxtLink to="/publish/posts/new" target="_blank">+ Viết bài mới</NuxtLink>
        </div>
      </el-form-item>
    </el-form>

    <div v-if="list.length" class="space-y-1">
      <div v-for="(id, i) in list" :key="id" class="flex items-center gap-2 rounded border border-slate-200 px-3 py-1.5 text-sm">
        <span class="w-6 text-right text-slate-400">{{ i + 1 }}.</span>
        <span class="flex-1 truncate">{{ byId(id)?.title ?? id }}</span>
        <el-tag v-if="byId(id) && byId(id)!.status !== 'ready'" size="small" type="warning">nháp</el-tag>
        <el-tooltip v-if="byId(id) && problems(byId(id)!).length" :content="problems(byId(id)!).join('\n')">
          <el-tag size="small" type="danger">không hợp {{ problems(byId(id)!).length }} nền tảng</el-tag>
        </el-tooltip>
        <el-button link size="small" :disabled="i === 0" @click="move(i, -1)">▲</el-button>
        <el-button link size="small" :disabled="i === list.length - 1" @click="move(i, 1)">▼</el-button>
      </div>
    </div>

    <el-form label-position="top" class="grid grid-cols-1 gap-x-6 md:grid-cols-3" @submit.prevent>
      <el-form-item label="Thứ tự">
        <el-radio-group v-model="form.order">
          <el-radio value="sequential">Tuần tự</el-radio>
          <el-radio value="random">Ngẫu nhiên (không lặp trong 1 vòng)</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="Khi hết bài">
        <el-radio-group v-model="form.whenExhausted">
          <el-radio value="stop">Dừng</el-radio>
          <el-radio value="loop">Quay lại từ đầu</el-radio>
          <el-radio value="wait">Chờ bài mới</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="allAccounts.length > 1" label="Nhiều tài khoản cùng đăng thì mỗi lượt">
        <el-radio-group v-model="form.assignment">
          <el-radio value="same">Cùng một bài</el-radio>
          <el-radio value="rotate">Mỗi người một bài khác (lệch nhau trong kho)</el-radio>
          <el-radio value="separate">Mỗi người danh sách riêng</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>

    <div v-if="form.assignment === 'separate' && allAccounts.length" class="space-y-2">
      <div class="text-sm text-slate-600">Danh sách bài riêng của từng tài khoản (để trống = dùng kho chung):</div>
      <div v-for="id in allAccounts" :key="id" class="flex items-center gap-2">
        <span class="w-36 shrink-0 truncate text-sm">{{ name(id) }}</span>
        <el-select :model-value="separateFor(id)" multiple filterable class="flex-1" @update:model-value="(v: string[]) => setSeparate(id, v)">
          <el-option v-for="p in library" :key="p._id" :value="p._id" :label="p.title" />
        </el-select>
      </div>
    </div>
  </div>
</template>
