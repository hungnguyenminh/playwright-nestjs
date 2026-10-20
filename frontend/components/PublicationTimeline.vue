<script setup lang="ts">
import type { Destination, Publication } from '~/types/api';

/** Publications of a campaign (or of every campaign), live, with per-publication actions. */
const props = defineProps<{ items: Publication[]; destinations?: Destination[]; showCampaign?: boolean; compact?: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const { api } = useApi();

const dest = (p: Publication) => props.destinations?.[p.destIndex] ?? { platform: p.platform, kind: p.kind, url: p.url };

async function act(p: Publication, action: 'skip' | 'retry' | 'mark-published') {
  const ok = await tryApi(() => api(`/publications/${p._id}/${action}`, { method: 'POST' }), action === 'skip' ? 'Đã bỏ qua' : action === 'retry' ? 'Sẽ đăng lại ngay' : 'Đã đánh dấu đã đăng');
  if (ok) emit('changed');
}
async function reschedule(p: Publication) {
  const res = await ElMessageBox.prompt('Giờ mới (dd/mm/yyyy hh:mm)', 'Đổi giờ đăng', {
    inputValue: fmtDate(p.scheduledAt),
    inputPattern: /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
    inputErrorMessage: 'Dạng 20/10/2026 08:30',
  }).catch(() => undefined);
  if (!res) return;
  const [d, m, y, h, mi] = res.value.split(/[/ :]/).map(Number);
  if (await tryApi(() => api(`/publications/${p._id}`, { method: 'PUT', body: { scheduledAt: new Date(y, m - 1, d, h, mi).toISOString() } }), 'Đã đổi giờ')) emit('changed');
}
</script>

<template>
  <el-empty v-if="!items.length" description="Chưa có lượt đăng" :image-size="50" />
  <el-table v-else :data="items" size="small" row-key="_id">
    <el-table-column label="Giờ" width="150">
      <template #default="{ row }">
        <div>{{ fmtDate(row.scheduledAt) }}</div>
        <div v-if="movedBy(row.scheduledAt, row.originalAt)" class="text-xs text-amber-600" :title="`Giờ ban đầu ${fmtDate(row.originalAt)}`">
          {{ movedBy(row.scheduledAt, row.originalAt) }}
        </div>
      </template>
    </el-table-column>
    <el-table-column v-if="showCampaign" label="Chiến dịch" min-width="140" show-overflow-tooltip>
      <template #default="{ row }">
        <NuxtLink :to="`/publish/campaigns/${row.campaignId}`">{{ row.campaignName }}</NuxtLink>
      </template>
    </el-table-column>
    <el-table-column label="Nơi đăng" min-width="200" show-overflow-tooltip>
      <template #default="{ row }">{{ destinationLabel(dest(row as Publication)) }}</template>
    </el-table-column>
    <el-table-column label="Tài khoản" min-width="120">
      <template #default="{ row }">
        <span :class="row.profileId ? '' : 'text-slate-400'" :title="row.profileId ? '' : 'Dự kiến, chốt lúc tới lượt'">{{ row.profileName ?? '—' }}</span>
        <div v-if="row.attempts?.length" class="text-xs text-amber-600" :title="row.attempts.map((a: any) => a.error).join('\n')">đã đổi {{ row.attempts.length }} lần</div>
      </template>
    </el-table-column>
    <el-table-column label="Bài" min-width="160" show-overflow-tooltip>
      <template #default="{ row }">
        <NuxtLink v-if="row.postId || row.plannedPostId" :to="`/publish/posts/${row.postId ?? row.plannedPostId}`" :class="row.postId ? '' : 'text-slate-400'">{{ row.postTitle ?? '(bài)' }}</NuxtLink>
        <span v-else class="text-slate-400">lấy lúc tới lượt</span>
      </template>
    </el-table-column>
    <el-table-column label="Trạng thái" min-width="170">
      <template #default="{ row }">
        <el-tag size="small" :type="PUBLICATION_STATUS[row.status as keyof typeof PUBLICATION_STATUS].type">{{ PUBLICATION_STATUS[row.status as keyof typeof PUBLICATION_STATUS].label }}</el-tag>
        <div v-if="row.waitReason && row.status === 'waiting'" class="text-xs text-amber-600">{{ row.waitReason }}</div>
        <div v-if="row.error && !compact" class="line-clamp-2 text-xs text-red-600" :title="row.error">{{ row.error }}</div>
        <a v-if="row.postUrl" :href="row.postUrl" target="_blank" rel="noopener" class="text-xs">Xem bài ↗</a>
        <NuxtLink v-if="row.taskId" :to="`/tasks/${row.taskId}`" class="ml-2 text-xs">task</NuxtLink>
      </template>
    </el-table-column>
    <el-table-column v-if="!compact" label="" width="170" align="right">
      <template #default="{ row }">
        <template v-if="['scheduled', 'waiting'].includes(row.status)">
          <el-button link size="small" @click="reschedule(row as Publication)">Đổi giờ</el-button>
          <el-button link size="small" type="warning" @click="act(row as Publication, 'skip')">Bỏ qua</el-button>
        </template>
        <template v-if="['failed', 'unknown', 'skipped'].includes(row.status)">
          <el-button link size="small" type="primary" @click="act(row as Publication, 'retry')">Đăng lại</el-button>
          <el-button v-if="row.status !== 'skipped'" link size="small" @click="act(row as Publication, 'mark-published')">Đã đăng</el-button>
        </template>
      </template>
    </el-table-column>
  </el-table>
</template>
