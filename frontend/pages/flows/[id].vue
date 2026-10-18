<script setup lang="ts">
import type { DatasetSummary, Flow, Job, Profile, Script, SourceCatalog, SourceSpec } from '~/types/api';

const route = useRoute();
const id = computed(() => route.params.id as string);
const { api } = useApi();

const flow = ref<Flow>();
const script = ref<Script>();
const profile = ref<Profile>();
const datasets = ref<DatasetSummary[]>([]);
const catalog = ref<SourceCatalog>();
const profiles = ref<Profile[]>([]);
const isSources = computed(() => flow.value?.kind === 'sources');
const sourceLabel = (type?: string) => catalog.value?.sources.find((c) => c.type === type)?.label ?? type ?? '';
const nonEmpty = (l?: string[]) => (l ?? []).map((x) => x.trim()).filter(Boolean);
const sourceTasks = (src: SourceSpec) => nonEmpty(src.targets).length * (src.type === 'website' ? Math.max(1, nonEmpty(src.keywords).length) : 1);

const page = reactive({ page: 1, limit: 10 });
const runs = useJobsList(() => ({ ...page }), `/flows/${id.value}/jobs`);

async function load() {
  flow.value = await tryApi(() => api<Flow>(`/flows/${id.value}`));
  if (!flow.value) return;
  const [s, p, d, cat, ps] = await Promise.all([
    flow.value.scriptId ? tryApi(() => api<Script>(`/scripts/${flow.value!.scriptId}`)) : undefined,
    flow.value.profileId ? tryApi(() => api<Profile>(`/profiles/${flow.value!.profileId}`)) : undefined,
    tryApi(() => api<DatasetSummary[]>('/data/datasets')),
    isSources.value ? tryApi(() => api<SourceCatalog>('/sources')) : undefined,
    isSources.value ? tryApi(() => api<Profile[]>('/profiles')) : undefined,
  ]);
  script.value = s;
  profile.value = p;
  catalog.value = cat;
  profiles.value = ps ?? [];
  datasets.value = (d ?? []).filter((x) => x.scope === `flow:${id.value}`);
}
load();

// Refresh data counts when a run of this flow finishes.
useLiveEvent<Partial<Job> & { _id: string }>('job:update', (patch) => {
  if (patch.status && ['done', 'failed', 'cancelled'].includes(patch.status) && runs.data.value.items.some((j) => j._id === patch._id)) {
    setTimeout(load, 800);
  }
});

const taskCount = computed(() => {
  try {
    return parseInputs(flow.value?.inputsText ?? '').length || 1;
  } catch {
    return 1;
  }
});

const running = ref(false);
async function runNow(over: Record<string, unknown> = {}) {
  running.value = true;
  const res = await tryApi(() => api<Job | { runId: string; jobs: Job[] }>(`/flows/${id.value}/run`, { method: 'POST', body: over }));
  running.value = false;
  if (!res) return;
  if ('jobs' in res) {
    // One job per source: stay here, the runs table shows them all.
    ElMessage.success(`Đã bắt đầu ${res.jobs.length} job (mỗi nguồn một job)`);
    custom.open = false;
    if (res.jobs.length === 1) navigateTo(`/jobs/${res.jobs[0]._id}`);
    else runs.load();
  } else {
    ElMessage.success('Đã bắt đầu chạy');
    navigateTo(`/jobs/${res._id}`);
  }
}

const custom = reactive({ open: false, inputsText: '', headless: true });
function openCustom() {
  Object.assign(custom, { open: true, inputsText: flow.value?.inputsText ?? '', headless: flow.value?.headless ?? true });
}

async function remove() {
  const ok = await ElMessageBox.confirm('Xoá luồng này? Job và dữ liệu đã lấy vẫn được giữ.', 'Xoá luồng', {
    type: 'warning',
    confirmButtonText: 'Xoá',
  }).catch(() => false);
  if (!ok) return;
  if (await tryApi(() => api(`/flows/${id.value}`, { method: 'DELETE' }).then(() => true), 'Đã xoá')) navigateTo('/flows');
}
</script>

<template>
  <div v-if="flow" class="page">
    <PageHeader :title="flow.name" :subtitle="flow.description || `${flow.runs} lần chạy`" back="/flows">
      <template #actions>
        <el-button type="primary" :loading="running" @click="runNow()">▶ Chạy ngay</el-button>
        <el-button v-if="!isSources" @click="openCustom">Chạy với input khác…</el-button>
        <el-button v-else :loading="running" @click="runNow({ headless: false })">▶ Chạy, hiện cửa sổ Chrome</el-button>
        <el-button @click="navigateTo(`/flows/new?id=${flow._id}`)">Sửa luồng</el-button>
        <el-button type="danger" plain @click="remove">Xoá</el-button>
      </template>
    </PageHeader>

    <!-- source flow: one card per source -->
    <div v-if="isSources" class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <el-card v-for="(src, i) in flow.sources" :key="i" shadow="never">
        <div class="eyebrow">Nguồn {{ i + 1 }}</div>
        <div class="mt-1 font-medium">{{ sourceLabel(src.type) }}</div>
        <div class="text-xs text-gray-500">
          {{ sourceTasks(src) }} task · {{ src.limit ?? catalog?.defaultLimit ?? 50 }} mục mỗi {{ src.type === 'website' || src.type === 'facebook' ? 'link' : 'từ khoá' }}
          {{ src.detail ? '· có chi tiết' : '' }}
          {{ src.profileId ? `· profile ${profiles.find((p) => p._id === src.profileId)?.name ?? '(đã xoá)'}` : '' }}
        </div>
        <div class="mt-2 max-h-28 overflow-auto text-sm">
          <div v-for="t in nonEmpty(src.targets)" :key="t" class="truncate">{{ t }}</div>
          <div v-if="nonEmpty(src.keywords).length" class="mt-1 text-xs text-gray-500">từ khoá: {{ nonEmpty(src.keywords).join(', ') }}</div>
        </div>
      </el-card>
      <el-card shadow="never">
        <div class="eyebrow">Dữ liệu đã lấy</div>
        <div v-if="!datasets.length" class="mt-1 text-sm text-gray-500">Chưa có (chạy xong sẽ tự lưu)</div>
        <div v-for="d in datasets" :key="d.dataset" class="mt-1 flex items-center justify-between text-sm">
          <NuxtLink :to="{ path: '/data', query: { scope: d.scope, dataset: d.dataset } }">{{ d.dataset }}</NuxtLink>
          <span class="text-gray-500">{{ d.count }} dòng</span>
        </div>
        <div class="mt-2 text-xs text-gray-500">
          {{ flow.concurrency }} song song · {{ flow.headless ? 'headless' : 'headed' }} · retries {{ flow.maxRetries }}
        </div>
      </el-card>
    </div>

    <!-- the flow, step by step -->
    <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <el-card shadow="never">
        <div class="eyebrow">1 · Profile</div>
        <div class="mt-1 font-medium">{{ profile?.name ?? 'Không dùng' }}</div>
        <div class="text-xs text-gray-500">{{ profile ? profile.notes || 'giữ đăng nhập, task chạy lần lượt' : 'Chrome mới cho mỗi task' }}</div>
        <el-collapse v-if="profile" class="mt-2">
          <el-collapse-item title="Đăng nhập lại">
            <ProfileLoginBox :profile-id="profile._id" :profile-name="profile.name" :login-url="profile.loginUrl" />
          </el-collapse-item>
        </el-collapse>
      </el-card>
      <el-card shadow="never">
        <div class="eyebrow">2 · Script</div>
        <div class="mt-1 font-medium">{{ script?.name ?? '(đã bị xoá)' }}</div>
        <div class="text-xs text-gray-500">{{ (script?.actions ?? []).length }} bước · {{ script?.description }}</div>
        <NuxtLink v-if="script" :to="`/scripts/${script._id}`" class="text-sm">Mở trình soạn</NuxtLink>
      </el-card>
      <el-card shadow="never">
        <div class="eyebrow">3 · Job & task</div>
        <div class="mt-1 font-medium">{{ taskCount }} task mỗi lần chạy</div>
        <div class="text-xs text-gray-500">
          {{ flow.profileId && profile?.mode !== 'session' ? 'lần lượt' : `${flow.concurrency} song song` }} · {{ flow.headless ? 'headless' : 'headed' }} · retries
          {{ flow.maxRetries }} · timeout {{ flow.stepTimeout }}s
        </div>
        <el-collapse v-if="flow.inputsText" class="mt-2">
          <el-collapse-item title="Xem inputs">
            <pre class="m-0 max-h-40 overflow-auto text-xs">{{ flow.inputsText }}</pre>
          </el-collapse-item>
        </el-collapse>
      </el-card>
      <el-card shadow="never">
        <div class="eyebrow">4 · Dữ liệu đã lấy</div>
        <div v-if="!datasets.length" class="mt-1 text-sm text-gray-500">Chưa có (chạy xong sẽ tự lưu)</div>
        <div v-for="d in datasets" :key="d.dataset" class="mt-1 flex items-center justify-between text-sm">
          <NuxtLink :to="{ path: '/data', query: { scope: d.scope, dataset: d.dataset } }">{{ d.dataset }}</NuxtLink>
          <span class="text-gray-500">{{ d.count }} dòng</span>
        </div>
      </el-card>
    </div>

    <!-- runs -->
    <el-card shadow="never" :header="`Các lần chạy (${flow.runs})`" :body-class="runs.data.value.items.length ? '!p-0' : ''">
      <el-empty v-if="!runs.data.value.items.length" description="Chưa chạy lần nào" :image-size="60" />
      <el-table v-else :data="runs.data.value.items" @row-click="(row: any) => navigateTo(`/jobs/${row._id}`)">
        <el-table-column label="Lần chạy" prop="name" min-width="220" />
        <el-table-column v-if="isSources" label="Nguồn" width="140">
          <template #default="{ row }">{{ sourceLabel(row.source) }}</template>
        </el-table-column>
        <el-table-column label="Trạng thái" width="120">
          <template #default="{ row }"><StatusTag :status="row.status" /></template>
        </el-table-column>
        <el-table-column label="Tiến độ" min-width="260">
          <template #default="{ row }"><JobProgress :totals="row.totals" show-counts /></template>
        </el-table-column>
        <el-table-column label="Bắt đầu" width="180">
          <template #default="{ row }">{{ fmtDate(row.createdAt) }}</template>
        </el-table-column>
      </el-table>
      <div v-if="runs.data.value.total > page.limit" class="flex justify-end p-3">
        <el-pagination v-model:current-page="page.page" :page-size="page.limit" :total="runs.data.value.total" layout="prev, pager, next" small />
      </div>
    </el-card>

    <el-dialog v-model="custom.open" title="Chạy với input khác (chỉ lần này)" width="640px">
      <el-input v-model="custom.inputsText" type="textarea" :rows="8" class="font-mono" />
      <div class="mt-3">
        <el-switch v-model="custom.headless" :active-value="false" :inactive-value="true" active-text="headed" inactive-text="headless" />
      </div>
      <template #footer>
        <el-button @click="custom.open = false">Huỷ</el-button>
        <el-button type="primary" :loading="running" @click="runNow({ inputsText: custom.inputsText, headless: custom.headless })">Chạy</el-button>
      </template>
    </el-dialog>
  </div>
</template>
