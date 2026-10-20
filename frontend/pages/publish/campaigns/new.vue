<script setup lang="ts">
import type { Campaign, CampaignForm, CampaignPreview, Job, Paged, Post, Profile } from '~/types/api';

/** Wizard: where & which accounts → posts → schedule → confirm (preview, rehearsal, activate). `?id=` edits. */
const route = useRoute();
const editId = computed(() => (route.query.id as string) || '');
const { api } = useApi();

const STEPS = ['Nơi đăng & tài khoản', 'Bài viết', 'Lịch', 'Xác nhận'];
const step = ref(0);
const profiles = ref<Profile[]>([]);
const posts = ref<Post[]>([]);

const form = ref<CampaignForm>({
  name: '',
  destinations: [],
  postSource: { type: 'list', postIds: [] },
  order: 'sequential',
  whenExhausted: 'stop',
  assignment: 'same',
  staggerMinutes: 60,
  minGapMinutes: 60,
  schedule: { mode: 'interval', startAt: new Date(Date.now() + 10 * 60_000).toISOString(), every: 1, unit: 'hour', jitterMinutes: 10, activeHours: { from: '07:00', to: '23:00' } },
  catchUp: 'shift',
  headless: true,
  dryRun: false,
});

onMounted(async () => {
  const [p, ps] = await Promise.all([tryApi(() => api<Profile[]>('/profiles')), tryApi(() => api<Paged<Post>>('/posts', { query: { limit: 200 } }))]);
  profiles.value = p ?? [];
  posts.value = ps?.items ?? [];
  if (!editId.value) return;
  const c = await tryApi(() => api<Campaign>(`/campaigns/${editId.value}`));
  if (!c) return;
  const { _id, status, log, createdAt, updatedAt, totals, nextAt, flowId, ...rest } = c as Campaign & Record<string, unknown>;
  form.value = { ...form.value, ...(rest as unknown as CampaignForm) };
});

function next() {
  if (step.value === 0) {
    if (!form.value.destinations.length) return ElMessage.error('Thêm ít nhất một điểm đăng');
    const empty = form.value.destinations.findIndex((d) => !d.profileIds.length);
    if (empty >= 0) return ElMessage.error(`Điểm đăng ${empty + 1}: chọn ít nhất một profile`);
    const noUrl = form.value.destinations.findIndex((d) => d.kind !== 'self' && !d.url?.trim());
    if (noUrl >= 0) return ElMessage.error(`Điểm đăng ${noUrl + 1}: nhập link`);
  }
  if (step.value === 1 && form.value.postSource.type === 'list' && !form.value.postSource.postIds.length) return ElMessage.error('Chọn ít nhất một bài');
  step.value++;
  if (step.value === 3) loadPreview();
}

// ---- confirm --------------------------------------------------------------------------
const preview = ref<CampaignPreview>();
const previewError = ref('');
async function loadPreview() {
  preview.value = undefined;
  previewError.value = '';
  try {
    preview.value = await api<CampaignPreview>('/campaigns/preview', { method: 'POST', body: body() });
  } catch (err) {
    previewError.value = apiErrorText(err);
  }
}
function body() {
  return { ...form.value, name: form.value.name.trim() || autoName() };
}
const autoName = () => `Lịch đăng ${form.value.destinations.map((d) => PLATFORM_LABEL[d.platform]).join(', ')}`;
const profileName = (id?: string) => profiles.value.find((p) => p._id === id)?.name ?? '—';
const postTitle = (id?: string) => (id ? (posts.value.find((p) => p._id === id)?.title ?? '(bài)') : 'lấy lúc tới lượt');

const saving = ref(false);
async function save(activate: boolean) {
  saving.value = true;
  const saved = await tryApi(() => (editId.value ? api<Campaign>(`/campaigns/${editId.value}`, { method: 'PUT', body: body() }) : api<Campaign>('/campaigns', { method: 'POST', body: body() })));
  let ok = !!saved;
  if (saved && activate && saved.status !== 'active') ok = !!(await tryApi(() => api(`/campaigns/${saved._id}/activate`, { method: 'POST' }), 'Đã kích hoạt'));
  saving.value = false;
  if (saved && ok) navigateTo(`/publish/campaigns/${saved._id}`);
}

/** Rehearsal: first destination, first account, first post; stops before "Post". */
const testing = ref(false);
async function rehearse() {
  const d = form.value.destinations[0];
  const postId = form.value.postSource.type === 'list' ? form.value.postSource.postIds[0] : undefined;
  if (!d || !postId) return;
  testing.value = true;
  const job = await tryApi(() =>
    api<Job>('/publish/test', { method: 'POST', body: { postId, target: { platform: d.platform, kind: d.kind, url: d.url || undefined, profileId: d.profileIds[0] }, headless: false } }),
  );
  testing.value = false;
  if (job) {
    const tasks = await api<Paged<{ _id: string }>>(`/jobs/${job._id}/tasks`);
    window.open(`/tasks/${tasks.items[0]._id}`, '_blank');
  }
}
</script>

<template>
  <div class="page !max-w-6xl">
    <PageHeader :title="editId ? 'Sửa lịch đăng' : 'Lịch đăng mới'" subtitle="Nơi đăng & tài khoản → bài viết → lịch → xác nhận." back="/publish/campaigns" />

    <el-card shadow="never">
      <el-steps :active="step" finish-status="success" align-center>
        <el-step v-for="(s, i) in STEPS" :key="s" :title="s" class="cursor-pointer" @click="i < step && (step = i)" />
      </el-steps>
    </el-card>

    <el-card v-show="step === 0" shadow="never" header="1. Đăng ở đâu, bằng tài khoản nào">
      <el-input v-model="form.name" placeholder="Tên lịch đăng (vd: Khuyến mãi tháng 10)" class="mb-4 max-w-xl" />
      <DestinationsEditor v-model="form.destinations" :profiles="profiles" />
    </el-card>

    <el-card v-show="step === 1" shadow="never" header="2. Bài viết">
      <PostsPicker v-model="form" :profiles="profiles" />
    </el-card>

    <el-card v-show="step === 2" shadow="never" header="3. Lịch">
      <ScheduleEditor v-model="form" />
    </el-card>

    <el-card v-show="step === 3" shadow="never" header="4. Xác nhận">
      <el-alert v-if="previewError" type="error" :title="previewError" :closable="false" show-icon class="mb-3" />
      <template v-if="preview">
        <el-alert v-for="e in preview.errors" :key="e" type="error" :title="e" :closable="false" show-icon class="mb-2" />
        <el-alert v-for="w in preview.warnings" :key="w" type="warning" :title="w" :closable="false" show-icon class="mb-2" />
        <div class="mb-2 mt-3 text-sm text-slate-600">
          Xem trước {{ preview.publications.length }} lượt đầu (tài khoản và bài là <i>dự kiến</i>, được chốt lúc tới lượt):
        </div>
        <el-table :data="preview.publications" size="small" max-height="420">
          <el-table-column label="Giờ" width="150">
            <template #default="{ row }">{{ fmtDate(row.scheduledAt) }}</template>
          </el-table-column>
          <el-table-column label="Nơi đăng" min-width="220">
            <template #default="{ row }">{{ destinationLabel(form.destinations[row.destIndex]) }}</template>
          </el-table-column>
          <el-table-column label="Tài khoản dự kiến" min-width="140">
            <template #default="{ row }">{{ profileName(row.plannedProfileId) }}</template>
          </el-table-column>
          <el-table-column label="Bài dự kiến" min-width="180">
            <template #default="{ row }">{{ postTitle(row.plannedPostId) }}</template>
          </el-table-column>
        </el-table>
      </template>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <el-checkbox v-model="form.headless">Chạy ẩn (headless)</el-checkbox>
        <el-checkbox v-model="form.dryRun">Chế độ đăng thử: mọi lượt dừng trước nút Đăng</el-checkbox>
      </div>
    </el-card>

    <div class="flex flex-wrap justify-between gap-2">
      <el-button :disabled="step === 0" @click="step--">← Quay lại</el-button>
      <div class="flex flex-wrap gap-2">
        <template v-if="step === 3">
          <el-button :loading="testing" :disabled="!preview || form.postSource.type !== 'list'" title="Soạn bài đầu tiên ở điểm đăng đầu tiên với tài khoản đầu tiên, dừng trước nút Đăng" @click="rehearse">
            Đăng thử 1 bài
          </el-button>
          <el-button :loading="saving" @click="save(false)">Lưu nháp</el-button>
          <el-button type="primary" :loading="saving" :disabled="!preview || !!preview.errors.length" @click="save(true)">Lưu &amp; kích hoạt</el-button>
        </template>
        <el-button v-else type="primary" @click="next">Tiếp tục →</el-button>
      </div>
    </div>
  </div>
</template>
