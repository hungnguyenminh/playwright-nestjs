<script setup lang="ts">
import type { Campaign, Flow, FlowRun, Paged, Post, PostStatus, Publication, SourceCatalog } from '~/types/api';

/** A crawl → publish flow: its crawl runs, the posts waiting for review, and the publishing schedule. */
const route = useRoute();
const id = computed(() => route.params.id as string);
const { api } = useApi();

const flow = ref<Flow>();
const runs = ref<FlowRun[]>([]);
const posts = ref<Post[]>([]);
const campaign = ref<Campaign>();
const pubs = ref<Publication[]>([]);
const catalog = ref<SourceCatalog>();

async function load() {
  const f = await tryApi(() => api<Flow>(`/flows/${id.value}`));
  if (!f) return;
  flow.value = f;
  const [r, p, c, pb] = await Promise.all([
    tryApi(() => api<FlowRun[]>(`/flows/${id.value}/runs`)),
    tryApi(() => api<Paged<Post>>('/posts', { query: { flowId: id.value, limit: 200 } })),
    f.campaignId ? tryApi(() => api<Campaign>(`/campaigns/${f.campaignId}`)) : undefined,
    f.campaignId ? tryApi(() => api<Paged<Publication>>(`/campaigns/${f.campaignId}/publications`, { query: { limit: 500 } })) : undefined,
  ]);
  runs.value = r ?? [];
  posts.value = p?.items ?? [];
  campaign.value = c;
  pubs.value = pb?.items ?? [];
}
onMounted(async () => {
  catalog.value = await tryApi(() => api<SourceCatalog>('/sources'));
  load();
});

// Live: crawl jobs ending, publications changing.
useLiveRoom('subscribe:jobs', {});
let timer: ReturnType<typeof setTimeout> | undefined;
const later = () => {
  clearTimeout(timer);
  timer = setTimeout(load, 1500);
};
useLiveEvent<{ status?: string }>('job:update', (p) => p.status && ['done', 'failed', 'cancelled'].includes(p.status) && later());
useLiveEvent<{ campaignId: string }>('publication:update', (p) => p.campaignId === flow.value?.campaignId && later());
const poll = setInterval(() => runs.value.some((r) => ['crawling', 'generating'].includes(r.status)) && load(), 5000);
onBeforeUnmount(() => clearInterval(poll));

const count = (s: PostStatus) => posts.value.filter((p) => p.status === s).length;
const drafts = computed(() => posts.value.filter((p) => p.status === 'draft'));
const upcoming = computed(() => pubs.value.filter((p) => ['scheduled', 'waiting', 'running'].includes(p.status)).slice(0, 15));
const done = computed(() => pubs.value.filter((p) => !['scheduled', 'waiting', 'running'].includes(p.status)).reverse().slice(0, 30));

const busy = ref(false);
async function act(fn: () => Promise<unknown>, ok: string) {
  busy.value = true;
  if (await tryApi(fn, ok)) await load();
  busy.value = false;
}
const runNow = () => act(() => api(`/flows/${id.value}/run`, { method: 'POST', body: {} }), 'Đã bắt đầu kéo dữ liệu');
const toggleAuto = (enabled: boolean) => act(() => api(`/flows/${id.value}/auto-run`, { method: 'POST', body: { enabled } }), enabled ? 'Đã bật tự kéo' : 'Đã tắt tự kéo');
const campaignAct = (a: 'pause' | 'resume') => act(() => api(`/campaigns/${flow.value!.campaignId}/${a}`, { method: 'POST' }), a === 'pause' ? 'Đã tạm dừng đăng' : 'Đã tiếp tục đăng');
const approve = (ids: string[]) => act(() => api('/posts/bulk-status', { method: 'POST', body: { ids, status: 'ready' } }), 'Đã duyệt');
const archive = (ids: string[]) => act(() => api('/posts/bulk-status', { method: 'POST', body: { ids, status: 'archived' } }), 'Đã bỏ');

async function remove() {
  const ok = await ElMessageBox.confirm('Xoá luồng và lịch đăng của nó? Dữ liệu đã kéo và các bài đã viết vẫn được giữ.', 'Xoá luồng', { type: 'warning', confirmButtonText: 'Xoá' }).catch(() => false);
  if (ok && (await tryApi(() => api(`/flows/${id.value}`, { method: 'DELETE' }).then(() => true), 'Đã xoá'))) navigateTo('/pipelines');
}

const RUN_STATUS: Record<FlowRun['status'], { label: string; type: 'primary' | 'success' | 'danger' | 'warning' }> = {
  crawling: { label: 'Đang kéo', type: 'primary' },
  generating: { label: 'AI đang viết', type: 'warning' },
  done: { label: 'Xong', type: 'success' },
  failed: { label: 'Lỗi', type: 'danger' },
};
const sourceLabel = (t: string) => catalog.value?.sources.find((c) => c.type === t)?.label ?? t;
</script>

<template>
  <div v-if="flow" class="page">
    <PageHeader :title="flow.name" :subtitle="flow.description || 'Kéo dữ liệu → AI viết bài → đăng theo lịch'" back="/pipelines">
      <template #actions>
        <el-button type="primary" :loading="busy" @click="runNow">▶ Chạy ngay (kéo + viết bài)</el-button>
        <el-button v-if="campaign?.status === 'active'" :loading="busy" @click="campaignAct('pause')">⏸ Tạm dừng đăng</el-button>
        <el-button v-else-if="campaign?.status === 'paused'" type="success" :loading="busy" @click="campaignAct('resume')">▶ Tiếp tục đăng</el-button>
        <el-button @click="navigateTo(`/pipelines/new?id=${flow._id}`)">Sửa</el-button>
        <el-button type="danger" plain @click="remove">Xoá</el-button>
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <el-card shadow="never">
        <div class="eyebrow">1 · Kéo dữ liệu</div>
        <div class="mt-1 text-sm">
          <div v-for="(s, i) in flow.sources" :key="i" class="truncate">{{ sourceLabel(s.type) }}: {{ s.targets.join(', ') }}</div>
        </div>
        <div class="mt-2 flex items-center gap-2 text-sm">
          <el-switch :model-value="!!flow.autoRun?.enabled" :loading="busy" @update:model-value="(v) => toggleAuto(!!v)" />
          <span v-if="flow.autoRun?.enabled">mỗi {{ flow.autoRun.every }} {{ flow.autoRun.unit === 'day' ? 'ngày' : 'giờ' }} · lần tới {{ flow.autoRun.nextRunAt ? fmtDate(flow.autoRun.nextRunAt) : '—' }}</span>
          <span v-else class="text-slate-500">tự kéo đang tắt</span>
        </div>
        <NuxtLink :to="{ path: '/data' }" class="mt-1 inline-block text-xs">Xem dữ liệu đã kéo →</NuxtLink>
      </el-card>
      <el-card shadow="never">
        <div class="eyebrow">2 · Bài AI viết</div>
        <div class="mt-1 flex gap-4 text-sm">
          <span><b>{{ count('draft') }}</b> chờ duyệt</span>
          <span><b>{{ count('ready') }}</b> sẵn sàng</span>
          <span class="text-slate-500">{{ count('archived') }} bỏ</span>
        </div>
        <div class="mt-1 text-xs text-slate-500">
          {{ flow.generate?.platforms.map((p) => PLATFORM_LABEL[p]).join(', ') }} · tối đa {{ flow.generate?.maxPostsPerRun }} bài / lần ·
          {{ flow.generate?.approval === 'auto' ? 'tự duyệt' : 'chờ bạn duyệt' }}
        </div>
        <NuxtLink :to="{ path: '/publish/posts', query: { tag: flow.name } }" class="mt-1 inline-block text-xs">Mở trong Bài viết →</NuxtLink>
      </el-card>
      <el-card shadow="never">
        <div class="eyebrow">3 · Lịch đăng</div>
        <div v-if="campaign" class="mt-1 text-sm">
          <el-tag size="small" :type="CAMPAIGN_STATUS[campaign.status].type">{{ CAMPAIGN_STATUS[campaign.status].label }}</el-tag>
          <span v-if="campaign.dryRun" class="ml-2 text-xs text-amber-600">đăng thử</span>
          <div v-for="(d, i) in campaign.destinations" :key="i" class="mt-1 truncate text-xs">{{ destinationLabel(d) }} · {{ d.profileIds.length }} tài khoản</div>
          <NuxtLink :to="`/publish/campaigns/${campaign._id}`" class="mt-1 inline-block text-xs">Mở lịch đăng →</NuxtLink>
        </div>
      </el-card>
    </div>

    <el-card shadow="never" header="Các lần kéo" :body-class="runs.length ? '!p-0' : ''">
      <el-empty v-if="!runs.length" description="Chưa kéo lần nào: bấm Chạy ngay" :image-size="50" />
      <el-table v-else :data="runs" size="small" max-height="300">
        <el-table-column label="Bắt đầu" width="150"><template #default="{ row }">{{ fmtDate(row.startedAt) }}</template></el-table-column>
        <el-table-column label="" width="90"><template #default="{ row }">{{ row.trigger === 'auto' ? 'tự động' : 'bấm tay' }}</template></el-table-column>
        <el-table-column label="Trạng thái" width="130">
          <template #default="{ row }">
            <el-tag size="small" :type="RUN_STATUS[row.status as FlowRun['status']].type">{{ RUN_STATUS[row.status as FlowRun['status']].label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Dòng mới" prop="newRecords" width="90" align="center" />
        <el-table-column label="Bài đã viết" prop="postsCreated" width="100" align="center" />
        <el-table-column label="Ghi chú" min-width="220" show-overflow-tooltip><template #default="{ row }">{{ row.error ?? '' }}</template></el-table-column>
      </el-table>
    </el-card>

    <el-card v-if="drafts.length" shadow="never">
      <template #header>
        <div class="flex items-center gap-2">
          <span class="font-semibold">Bài chờ duyệt ({{ drafts.length }})</span>
          <el-button size="small" type="success" class="!ml-auto" :loading="busy" @click="approve(drafts.map((p) => p._id))">Duyệt tất cả</el-button>
        </div>
      </template>
      <div v-for="p in drafts" :key="p._id" class="flex items-start gap-3 border-b border-slate-100 py-2 last:border-0">
        <div class="min-w-0 flex-1">
          <NuxtLink :to="`/publish/posts/${p._id}`" class="font-medium">{{ p.title }}</NuxtLink>
          <div class="line-clamp-2 whitespace-pre-line text-sm text-slate-600">{{ p.content }}</div>
          <div v-for="(c, pl) in p.checks" :key="pl" class="text-xs" :class="c?.errors.length ? 'text-red-600' : 'text-slate-400'">
            {{ PLATFORM_LABEL[pl as keyof typeof PLATFORM_LABEL] }}: {{ c?.errors.length ? c.errors.join('; ') : 'hợp lệ' }}
          </div>
        </div>
        <el-button size="small" type="success" plain :loading="busy" @click="approve([p._id])">Duyệt</el-button>
        <el-button size="small" plain :loading="busy" @click="archive([p._id])">Bỏ</el-button>
      </div>
    </el-card>

    <el-card shadow="never" header="Sắp đăng">
      <PublicationTimeline :items="upcoming" :destinations="campaign?.destinations" @changed="load" />
    </el-card>
    <el-card v-if="done.length" shadow="never" header="Đã đăng / lỗi gần đây">
      <PublicationTimeline :items="done" :destinations="campaign?.destinations" @changed="load" />
    </el-card>
  </div>
</template>
