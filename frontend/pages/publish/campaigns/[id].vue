<script setup lang="ts">
import type { Campaign, Paged, Profile, Publication } from '~/types/api';

const route = useRoute();
const id = computed(() => route.params.id as string);
const { api } = useApi();

const campaign = ref<Campaign>();
const pubs = ref<Publication[]>([]);
const stats = ref<Array<{ destIndex: number; profileId: string; status: string; n: number }>>([]);
const profiles = ref<Profile[]>([]);
const filter = reactive({ destIndex: '' as number | '', status: '' });

async function load() {
  const q: Record<string, unknown> = { limit: 500 };
  if (filter.destIndex !== '') q.destIndex = filter.destIndex;
  if (filter.status) q.status = filter.status;
  const [c, p, s] = await Promise.all([
    tryApi(() => api<Campaign>(`/campaigns/${id.value}`)),
    tryApi(() => api<Paged<Publication>>(`/campaigns/${id.value}/publications`, { query: q })),
    tryApi(() => api<typeof stats.value>(`/campaigns/${id.value}/stats`)),
  ]);
  campaign.value = c;
  pubs.value = p?.items ?? [];
  stats.value = s ?? [];
}
onMounted(async () => {
  profiles.value = (await tryApi(() => api<Profile[]>('/profiles'))) ?? [];
  load();
});
watch(filter, load);
useLiveRoom('subscribe:jobs', {});
let timer: ReturnType<typeof setTimeout> | undefined;
useLiveEvent<{ campaignId: string }>('publication:update', (e) => {
  if (e.campaignId !== id.value) return;
  clearTimeout(timer);
  timer = setTimeout(load, 500);
});

async function act(action: 'activate' | 'pause' | 'resume' | 'cancel') {
  if (action === 'cancel') {
    const ok = await ElMessageBox.confirm('Huỷ lịch đăng? Các lượt chưa chạy sẽ bị huỷ.', 'Huỷ lịch', { type: 'warning', confirmButtonText: 'Huỷ lịch' }).catch(() => false);
    if (!ok) return;
  }
  if (await tryApi(() => api(`/campaigns/${id.value}/${action}`, { method: 'POST' }), 'Đã cập nhật')) load();
}
async function remove() {
  const ok = await ElMessageBox.confirm('Xoá lịch đăng và toàn bộ lượt đăng của nó? Bài đã đăng trên mạng xã hội vẫn còn.', 'Xoá', { type: 'warning', confirmButtonText: 'Xoá' }).catch(() => false);
  if (ok && (await tryApi(() => api(`/campaigns/${id.value}`, { method: 'DELETE' }).then(() => true), 'Đã xoá'))) navigateTo('/publish/campaigns');
}

const name = (pid: string) => profiles.value.find((p) => p._id === pid)?.name ?? pid;
/** Posts per account at each destination. */
const table = computed(() => {
  const rows = new Map<string, { destIndex: number; profileId: string; done: number; failed: number }>();
  for (const s of stats.value) {
    const key = `${s.destIndex}:${s.profileId}`;
    const row = rows.get(key) ?? { destIndex: s.destIndex, profileId: s.profileId, done: 0, failed: 0 };
    if (['published', 'pending_approval'].includes(s.status)) row.done += s.n;
    if (['failed', 'unknown'].includes(s.status)) row.failed += s.n;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.destIndex - b.destIndex || b.done - a.done);
});
</script>

<template>
  <div v-if="campaign" class="page">
    <PageHeader :title="campaign.name" back="/publish/campaigns">
      <template #subtitle>
        <el-tag size="small" :type="CAMPAIGN_STATUS[campaign.status].type">{{ CAMPAIGN_STATUS[campaign.status].label }}</el-tag>
        <span v-if="campaign.dryRun" class="ml-2 text-xs text-amber-600">chế độ đăng thử (dừng trước nút Đăng)</span>
      </template>
      <template #actions>
        <el-button v-if="campaign.status === 'draft'" type="primary" @click="act('activate')">▶ Kích hoạt</el-button>
        <el-button v-if="campaign.status === 'active'" @click="act('pause')">⏸ Tạm dừng</el-button>
        <el-button v-if="campaign.status === 'paused'" type="primary" @click="act('resume')">▶ Tiếp tục</el-button>
        <el-button v-if="['draft', 'paused'].includes(campaign.status)" @click="navigateTo(`/publish/campaigns/new?id=${campaign._id}`)">Sửa</el-button>
        <el-button v-if="['active', 'paused', 'draft'].includes(campaign.status)" type="warning" plain @click="act('cancel')">Huỷ lịch</el-button>
        <el-button type="danger" plain @click="remove">Xoá</el-button>
      </template>
    </PageHeader>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <el-card shadow="never" class="lg:col-span-2">
        <div class="eyebrow mb-2">Điểm đăng</div>
        <div v-for="(d, i) in campaign.destinations" :key="i" class="border-b border-slate-100 py-1.5 text-sm last:border-0">
          <b>{{ i + 1 }}.</b> {{ destinationLabel(d) }} ·
          {{ d.accountMode === 'rotate' ? 'xoay vòng' : 'tất cả cùng đăng' }}: {{ d.profileIds.map(name).join(', ') }}
          <span class="text-xs text-slate-500">
            · 1 profile cách {{ fmtMinutes(d.limits.minGapPerProfileMinutes) }}, tối đa {{ d.limits.maxPerProfilePerDay }} bài/ngày
          </span>
        </div>
      </el-card>
      <el-card shadow="never">
        <div class="eyebrow mb-2">Số bài mỗi tài khoản đã đăng</div>
        <el-empty v-if="!table.length" description="Chưa đăng bài nào" :image-size="40" />
        <div v-for="r in table" :key="`${r.destIndex}:${r.profileId}`" class="flex justify-between text-sm">
          <span class="truncate">{{ r.destIndex + 1 }}. {{ name(r.profileId) }}</span>
          <span>
            {{ r.done }}<span v-if="r.failed" class="text-red-600"> · {{ r.failed }} lỗi</span>
          </span>
        </div>
      </el-card>
    </div>

    <el-card shadow="never">
      <template #header>
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-semibold">Lượt đăng</span>
          <el-select v-model="filter.destIndex" clearable placeholder="Mọi điểm đăng" size="small" class="!w-56">
            <el-option v-for="(d, i) in campaign.destinations" :key="i" :value="i" :label="`${i + 1}. ${destinationLabel(d)}`" />
          </el-select>
          <el-select v-model="filter.status" clearable placeholder="Mọi trạng thái" size="small" class="!w-44">
            <el-option v-for="(s, k) in PUBLICATION_STATUS" :key="k" :value="k" :label="s.label" />
          </el-select>
        </div>
      </template>
      <PublicationTimeline :items="pubs" :destinations="campaign.destinations" @changed="load" />
    </el-card>

    <el-card v-if="campaign.log.length" shadow="never" header="Nhật ký">
      <div v-for="(l, i) in [...campaign.log].reverse()" :key="i" class="text-sm">
        <span class="text-slate-500">{{ fmtDate(l.at) }}</span> · {{ l.message }}
      </div>
    </el-card>
  </div>
</template>
