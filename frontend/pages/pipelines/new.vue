<script setup lang="ts">
import type { CampaignForm, Flow, GenerateSpec, Profile, SourceCatalog, SourceSpec } from '~/types/api';

/**
 * Wizard for a crawl → publish flow: what to crawl and how often, how the AI
 * writes posts from new rows, where / with which accounts / how often to post.
 * `?id=` edits.
 */
const route = useRoute();
const editId = computed(() => (route.query.id as string) || '');
const { api } = useApi();

const STEPS = ['Mục tiêu', 'Nguồn', 'Lịch kéo', 'Viết bài (AI)', 'Nơi đăng', 'Lịch đăng', 'Xác nhận'];
const step = ref(0);
const catalog = ref<SourceCatalog>();
const profiles = ref<Profile[]>([]);
const aiReady = ref(true);

const goal = reactive({ name: '', description: '' });
const sources = ref<SourceSpec[]>([]);
const crawl = reactive({ concurrency: 2, headless: true });
const auto = reactive({ enabled: true, every: 6, unit: 'hour' as 'hour' | 'day', useHours: false, from: '07:00', to: '23:00' });
const generate = ref<GenerateSpec>({
  mode: 'perRecord',
  digestSize: 5,
  prompt: '',
  length: 'medium',
  platforms: ['facebook'],
  maxPostsPerRun: 5,
  attachImage: true,
  approval: 'review',
});
const campaign = ref<CampaignForm>({
  name: '',
  destinations: [],
  postSource: { type: 'list', postIds: [] },
  order: 'sequential',
  whenExhausted: 'wait',
  assignment: 'same',
  staggerMinutes: 60,
  minGapMinutes: 60,
  schedule: { mode: 'interval', startAt: new Date(Date.now() + 10 * 60_000).toISOString(), every: 2, unit: 'hour', jitterMinutes: 10, activeHours: { from: '07:00', to: '22:00' } },
  catchUp: 'shift',
  headless: true,
  dryRun: false,
});

const nonEmpty = (l?: string[]) => (l ?? []).map((x) => x.trim()).filter(Boolean);

function next() {
  if (step.value === 0 && !goal.name.trim()) return ElMessage.error('Đặt tên cho luồng');
  if (step.value === 1) {
    if (!sources.value.length) return ElMessage.error('Thêm ít nhất một nguồn');
    if (sources.value.some((s) => !nonEmpty(s.targets).length)) return ElMessage.error('Nhập link / từ khoá cho mọi nguồn');
  }
  if (step.value === 3 && !generate.value.platforms.length) return ElMessage.error('Chọn nền tảng để AI viết');
  if (step.value === 4) {
    if (!campaign.value.destinations.length) return ElMessage.error('Thêm ít nhất một nơi đăng');
    if (campaign.value.destinations.some((d) => !d.profileIds.length)) return ElMessage.error('Chọn profile cho mọi nơi đăng');
    const off = campaign.value.destinations.find((d) => !generate.value.platforms.includes(d.platform));
    if (off) return ElMessage.error(`AI chưa viết cho ${PLATFORM_LABEL[off.platform]}: thêm nền tảng ở bước Viết bài`);
  }
  step.value++;
}

function body() {
  const { name: _n, postSource: _p, order: _o, whenExhausted: _w, ...publish } = campaign.value;
  return {
    name: goal.name.trim(),
    description: goal.description,
    kind: 'pipeline',
    sources: sources.value.map((s) => ({ ...s, profileId: s.profileId || undefined })),
    concurrency: crawl.concurrency,
    headless: crawl.headless,
    maxRetries: 0,
    stepTimeout: 30,
    autoRun: { enabled: auto.enabled, every: auto.every, unit: auto.unit, ...(auto.useHours ? { activeHours: { from: auto.from, to: auto.to } } : {}) },
    generate: generate.value,
    campaign: publish,
  };
}

const saving = ref(false);
async function save(runNow: boolean) {
  saving.value = true;
  const flow = await tryApi(() =>
    editId.value ? api<Flow>(`/flows/${editId.value}`, { method: 'PUT', body: body() }) : api<Flow>('/flows', { method: 'POST', body: body() }),
  );
  if (flow && runNow) await tryApi(() => api(`/flows/${flow._id}/run`, { method: 'POST', body: {} }), 'Đã bắt đầu kéo dữ liệu');
  saving.value = false;
  if (flow) navigateTo(`/pipelines/${flow._id}`);
}

onMounted(async () => {
  const [cat, ps, ai] = await Promise.all([
    tryApi(() => api<SourceCatalog>('/sources')),
    tryApi(() => api<Profile[]>('/profiles')),
    tryApi(() => api<{ configured: boolean }>('/ai/status')),
  ]);
  catalog.value = cat;
  profiles.value = ps ?? [];
  aiReady.value = !!ai?.configured;
  if (!editId.value) return;
  const flow = await tryApi(() => api<Flow>(`/flows/${editId.value}`));
  if (!flow) return;
  Object.assign(goal, { name: flow.name, description: flow.description });
  sources.value = flow.sources.map((s) => ({ ...s, profileId: s.profileId ?? '' }));
  Object.assign(crawl, { concurrency: flow.concurrency, headless: flow.headless });
  if (flow.autoRun) Object.assign(auto, { enabled: flow.autoRun.enabled, every: flow.autoRun.every, unit: flow.autoRun.unit, useHours: !!flow.autoRun.activeHours, ...(flow.autoRun.activeHours ?? {}) });
  if (flow.generate) generate.value = { ...generate.value, ...flow.generate };
  if (flow.campaignId) {
    const c = await tryApi(() => api<CampaignForm>(`/campaigns/${flow.campaignId}`));
    if (c) campaign.value = { ...campaign.value, destinations: c.destinations, schedule: c.schedule, staggerMinutes: c.staggerMinutes, minGapMinutes: c.minGapMinutes, catchUp: c.catchUp, headless: c.headless, dryRun: c.dryRun, assignment: c.assignment };
  }
});

const sourceLabel = (s: SourceSpec) => catalog.value?.sources.find((c) => c.type === s.type)?.label ?? s.type;
const intervalText = computed(() => {
  const s = campaign.value.schedule;
  return s.mode === 'interval' ? `mỗi ${s.every} ${({ minute: 'phút', hour: 'giờ', day: 'ngày' } as const)[s.unit]}${s.activeHours ? ` (${s.activeHours.from}–${s.activeHours.to})` : ''}` : '';
});
</script>

<template>
  <div class="page !max-w-6xl">
    <PageHeader :title="editId ? 'Sửa luồng Kéo → Đăng' : 'Luồng Kéo → Đăng mới'" subtitle="Tự kéo dữ liệu → AI viết bài từ dữ liệu mới → tự đăng theo lịch." back="/pipelines" />

    <el-alert v-if="!aiReady" type="warning" show-icon :closable="false" title="Chưa cấu hình AI: vào Cài đặt → AI nhập token, nếu không luồng chỉ kéo dữ liệu mà không viết được bài." />

    <el-card shadow="never">
      <el-steps :active="step" finish-status="success" align-center>
        <el-step v-for="(s, i) in STEPS" :key="s" :title="s" class="cursor-pointer" @click="i < step && (step = i)" />
      </el-steps>
    </el-card>

    <el-card v-show="step === 0" shadow="never" header="1. Mục tiêu">
      <el-form label-position="top" class="max-w-2xl" @submit.prevent>
        <el-form-item label="Tên luồng"><el-input v-model="goal.name" placeholder="Ví dụ: Sản phẩm mới của shop → Facebook" /></el-form-item>
        <el-form-item label="Mô tả (không bắt buộc)"><el-input v-model="goal.description" type="textarea" :rows="2" /></el-form-item>
      </el-form>
    </el-card>

    <el-card v-show="step === 1" shadow="never" header="2. Kéo dữ liệu từ đâu">
      <SourcesEditor v-model="sources" :profiles="profiles" :catalog="catalog" />
    </el-card>

    <el-card v-show="step === 2" shadow="never" header="3. Lịch kéo dữ liệu">
      <AutoRunEditor v-model="auto" title="Tự kéo dữ liệu định kỳ" />
      <div class="mt-4 flex flex-wrap gap-6">
        <el-form label-position="top" @submit.prevent>
          <el-form-item label="Chạy song song (mỗi nguồn)"><el-input-number v-model="crawl.concurrency" :min="1" :max="10" /></el-form-item>
        </el-form>
        <el-form label-position="top" @submit.prevent>
          <el-form-item label="Hiện cửa sổ Chrome khi kéo">
            <el-switch v-model="crawl.headless" :active-value="false" :inactive-value="true" active-text="có" inactive-text="không" />
          </el-form-item>
        </el-form>
      </div>
    </el-card>

    <el-card v-show="step === 3" shadow="never" header="4. AI viết bài từ dữ liệu mới">
      <GenerateEditor v-model="generate" show-limit />
    </el-card>

    <el-card v-show="step === 4" shadow="never" header="5. Đăng ở đâu, bằng tài khoản nào">
      <DestinationsEditor v-model="campaign.destinations" :profiles="profiles" />
    </el-card>

    <el-card v-show="step === 5" shadow="never" header="6. Lịch đăng">
      <p class="mt-0 text-sm text-slate-600">
        Mỗi lượt đăng lấy bài <b>Sẵn sàng</b> cũ nhất của luồng chưa đăng ở nơi đó. Hết bài thì lượt đó chờ, có bài mới thì đăng ngay và dời các lượt sau.
      </p>
      <ScheduleEditor v-model="campaign" interval-only />
    </el-card>

    <el-card v-show="step === 6" shadow="never" header="7. Xác nhận">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="Luồng">{{ goal.name }}</el-descriptions-item>
        <el-descriptions-item label="Kéo">
          <div v-for="(s, i) in sources" :key="i">
            <b>{{ sourceLabel(s) }}</b>: {{ nonEmpty(s.targets).join(', ') }} · {{ s.limit }} mục
          </div>
          <div class="text-slate-500">{{ auto.enabled ? `Tự kéo mỗi ${auto.every} ${auto.unit === 'day' ? 'ngày' : 'giờ'}` : 'Chỉ kéo khi bấm Chạy ngay' }}</div>
        </el-descriptions-item>
        <el-descriptions-item label="Viết bài">
          {{ generate.mode === 'digest' ? `Gộp ${generate.digestSize} dòng / bài` : 'Mỗi dòng một bài' }}, tối đa {{ generate.maxPostsPerRun }} bài mỗi lần kéo ·
          {{ generate.platforms.map((p) => PLATFORM_LABEL[p]).join(', ') }} ·
          {{ generate.approval === 'auto' ? 'tự duyệt' : 'chờ bạn duyệt' }}{{ generate.attachImage ? ' · kèm ảnh' : '' }}
        </el-descriptions-item>
        <el-descriptions-item label="Đăng">
          <div v-for="(d, i) in campaign.destinations" :key="i">
            {{ destinationLabel(d) }} · {{ d.profileIds.length }} tài khoản{{ d.accountMode === 'rotate' ? ' xoay vòng' : '' }}
          </div>
          <div class="text-slate-500">{{ intervalText }}</div>
        </el-descriptions-item>
      </el-descriptions>
      <div class="mt-3">
        <el-checkbox v-model="campaign.dryRun">Chế độ đăng thử: mọi lượt dừng trước nút Đăng (để kiểm tra trước)</el-checkbox>
      </div>
    </el-card>

    <div class="flex flex-wrap justify-between gap-2">
      <el-button :disabled="step === 0" @click="step--">← Quay lại</el-button>
      <div class="flex gap-2">
        <template v-if="step === STEPS.length - 1">
          <el-button :loading="saving" @click="save(false)">Lưu</el-button>
          <el-button type="primary" :loading="saving" @click="save(true)">Lưu &amp; kéo dữ liệu ngay</el-button>
        </template>
        <el-button v-else type="primary" @click="next">Tiếp tục →</el-button>
      </div>
    </div>
  </div>
</template>
