<script setup lang="ts">
import type { Job, Paged, Profile, SourceCatalog, SourceInfo, SourceSpec, SourceType, Task, TaskPatch } from '~/types/api';

/**
 * Edits the data sources of a flow: links or keywords (one per line), items
 * per link / keyword, detail pages, the profile to log in with, and a quick
 * test run of each source.
 */
const model = defineModel<SourceSpec[]>({ required: true });
const props = defineProps<{ profiles: Profile[]; catalog?: SourceCatalog }>();
const { api } = useApi();

const ICON: Record<SourceType, string> = {
  website: '🌐',
  facebook: '📘',
  google: '🔎',
  youtube: '▶️',
  tiktok: '🎵',
  threads: '🧵',
  shopee: '🛍️',
};

const info = (type: SourceType): SourceInfo | undefined => props.catalog?.sources.find((s) => s.type === type);
const lines = (list?: string[]) => (list ?? []).map((s) => s.trim()).filter(Boolean);
const profileOf = (src: SourceSpec) => props.profiles.find((p) => p._id === src.profileId);

function add(type: SourceType) {
  model.value = [
    ...model.value,
    { type, targets: [], keywords: [], limit: props.catalog?.defaultLimit ?? 50, detail: false, profileId: '' },
  ];
}
function remove(i: number) {
  model.value = model.value.filter((_, k) => k !== i);
  delete tests[i];
}

/** Tasks one run of the source makes: links × keywords for websites. */
function taskCount(src: SourceSpec) {
  const t = new Set(lines(src.targets)).size;
  return src.type === 'website' ? t * Math.max(1, new Set(lines(src.keywords)).size) : t;
}

const totalTasks = computed(() => model.value.reduce((n, s) => n + taskCount(s), 0));
defineExpose({ totalTasks });

// ---- test run: first link / keyword, a few items, visible Chrome ----------------
const tests = reactive<Record<number, Task | undefined>>({});
const testing = ref<number | null>(null);
async function test(i: number) {
  const src = model.value[i];
  if (!lines(src.targets).length) return ElMessage.warning(`Nhập ${info(src.type)?.target === 'link' ? 'link' : 'từ khoá'} trước`);
  testing.value = i;
  const job = await tryApi(() => api<Job>('/sources/test', { method: 'POST', body: { ...src, profileId: src.profileId || undefined, headless: false } }));
  testing.value = null;
  if (job) tests[i] = (await api<Paged<Task>>(`/jobs/${job._id}/tasks`)).items[0];
}
const testJobIds = computed(() => Object.values(tests).filter(Boolean).map((t) => t!.jobId));
useLiveRoom('subscribe:job', () => (testJobIds.value.length ? { jobId: testJobIds.value[testJobIds.value.length - 1] } : null));
useLiveEvent<TaskPatch>('task:update', (p) => {
  for (const t of Object.values(tests)) if (t && t._id === p._id) Object.assign(t, p);
});

// ---- generated script -------------------------------------------------------------
const preview = reactive({ open: false, text: '' });
async function showScript(src: SourceSpec) {
  const res = await tryApi(() =>
    api<{ errors: string[]; job: { actions: unknown[]; inputs: unknown[] } | null }>('/sources/preview', { method: 'POST', body: src }),
  );
  if (!res) return;
  if (res.errors.length) return ElMessage.warning(res.errors.join('; '));
  preview.text = JSON.stringify({ actions: res.job!.actions, inputs: res.job!.inputs }, null, 2);
  preview.open = true;
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <div class="mb-2 text-sm text-gray-600">Thêm nguồn (thêm được nhiều nguồn, kể cả cùng loại):</div>
      <div class="flex flex-wrap gap-2">
        <el-button v-for="s in catalog?.sources ?? []" :key="s.type" @click="add(s.type)">
          <span class="mr-1">{{ ICON[s.type] }}</span>{{ s.label }}
        </el-button>
      </div>
    </div>

    <el-empty v-if="!model.length" description="Chưa có nguồn nào: bấm một nút ở trên để thêm" :image-size="60" />

    <el-card v-for="(src, i) in model" :key="i" shadow="never" class="source-card">
      <template #header>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-lg">{{ ICON[src.type] }}</span>
          <span class="font-semibold">{{ info(src.type)?.label ?? src.type }}</span>
          <el-tag v-if="info(src.type)?.login === 'required'" size="small" type="warning">cần đăng nhập</el-tag>
          <el-tag v-else-if="info(src.type)?.login === 'recommended'" size="small" type="info">nên đăng nhập</el-tag>
          <span class="text-xs text-gray-500">{{ taskCount(src) }} task mỗi lần chạy</span>
          <div class="ml-auto flex gap-1">
            <el-button size="small" :loading="testing === i" @click="test(i)">▶ Chạy thử</el-button>
            <el-button size="small" @click="showScript(src)">Xem script</el-button>
            <el-button size="small" type="danger" plain @click="remove(i)">Xoá</el-button>
          </div>
        </div>
      </template>

      <p class="mt-0 text-sm text-gray-600">{{ info(src.type)?.note }}</p>
      <el-form label-position="top" @submit.prevent>

      <div class="grid grid-cols-1 gap-4" :class="src.type === 'website' ? 'lg:grid-cols-2' : ''">
        <el-form-item :label="info(src.type)?.target === 'link' ? 'Link (mỗi dòng một link)' : 'Từ khoá (mỗi dòng một từ khoá)'" class="!mb-0">
          <el-input
            :model-value="src.targets.join('\n')"
            type="textarea"
            :rows="4"
            :placeholder="info(src.type)?.placeholder"
            @update:model-value="(v: string) => (src.targets = v.split('\n'))"
          />
        </el-form-item>
        <el-form-item v-if="src.type === 'website'" label="Từ khoá tìm trên trang (không bắt buộc, mỗi dòng một từ)" class="!mb-0">
          <el-input
            :model-value="(src.keywords ?? []).join('\n')"
            type="textarea"
            :rows="4"
            placeholder="Để trống: lấy dữ liệu ngay tại link.&#10;Có từ khoá: gõ vào ô tìm kiếm của trang rồi lấy kết quả."
            @update:model-value="(v: string) => (src.keywords = v.split('\n'))"
          />
        </el-form-item>
      </div>

      <div class="mt-4 flex flex-wrap items-start gap-x-8 gap-y-3">
        <el-form-item :label="`Số mục mỗi ${info(src.type)?.target === 'link' ? 'link' : 'từ khoá'}`" class="!mb-0">
          <el-input-number v-model="src.limit" :min="1" :max="catalog?.maxLimit ?? 500" />
        </el-form-item>
        <el-form-item label="Vào từng kết quả lấy chi tiết" class="!mb-0">
          <el-switch v-model="src.detail" />
          <span class="ml-2 text-xs text-gray-500">mô tả, nội dung, ngày đăng… (chậm hơn nhiều)</span>
        </el-form-item>
        <el-form-item label="Profile" class="!mb-0">
          <el-select v-model="src.profileId" clearable placeholder="Không dùng (Chrome mới)" class="!w-64">
            <el-option v-for="p in profiles" :key="p._id" :label="p.name" :value="p._id">
              <span>{{ p.name }}</span><span class="ml-2 text-xs text-gray-400">{{ p.mode === 'session' ? 'DB' : 'thư mục' }}</span>
            </el-option>
          </el-select>
          <div v-if="info(src.type)?.login === 'required' && !src.profileId" class="mt-1 text-xs text-amber-600">
            Nguồn này cần tài khoản: chọn profile đã đăng nhập (tạo ở trang Profiles).
          </div>
        </el-form-item>
      </div>

      </el-form>

      <el-collapse v-if="profileOf(src)" class="mt-3">
        <el-collapse-item :title="`Đăng nhập ${info(src.type)?.label} cho profile &quot;${profileOf(src)!.name}&quot; (bỏ qua nếu đã đăng nhập)`">
          <ProfileLoginBox
            :key="profileOf(src)!._id"
            :profile-id="profileOf(src)!._id"
            :profile-name="profileOf(src)!.name"
            :login-url="profileOf(src)!.loginUrl || info(src.type)?.loginUrl"
          />
        </el-collapse-item>
      </el-collapse>

      <div v-if="tests[i]" class="mt-3 max-w-md">
        <div class="mb-1 text-xs text-gray-500">Chạy thử với {{ info(src.type)?.target === 'link' ? 'link' : 'từ khoá' }} đầu tiên, tối đa 5 mục:</div>
        <TaskCard :task="tests[i]!" new-tab />
      </div>
    </el-card>

    <el-dialog v-model="preview.open" title="Script được tạo cho nguồn này" width="760px">
      <p class="mt-0 text-sm text-gray-600">Mỗi phần tử của <code>inputs</code> là một task. Bạn không cần sửa gì: luồng tự tạo script này mỗi lần chạy.</p>
      <pre class="m-0 max-h-[60vh] overflow-auto rounded bg-gray-50 p-3 text-xs">{{ preview.text }}</pre>
    </el-dialog>
  </div>
</template>
