<script setup lang="ts">
import type { Profile } from '~/types/api';

/** Selectors the publishers rely on: current value, who changed it and why, AI repair, revert. */
interface SelectorRow {
  key: string;
  platform: string;
  label: string;
  purpose: string;
  default: string;
  current: string;
  isDefault: boolean;
  scope: string;
  lastChange: { source: 'ai' | 'user'; reason: string; createdAt: string; model?: string } | null;
}
interface Version {
  _id: string;
  value: string;
  previous: string;
  source: 'ai' | 'user';
  reason: string;
  error?: string;
  model?: string;
  validated: boolean;
  taskId?: string;
  createdAt: string;
}

const { api } = useApi();
const rows = ref<SelectorRow[]>([]);
const profiles = ref<Profile[]>([]);
const load = async () => (rows.value = (await tryApi(() => api<SelectorRow[]>('/publish/selectors'))) ?? []);
onMounted(async () => {
  profiles.value = (await tryApi(() => api<Profile[]>('/profiles'))) ?? [];
  load();
});

const history = reactive({ open: false, row: null as SelectorRow | null, items: [] as Version[] });
async function openHistory(r: SelectorRow) {
  Object.assign(history, { open: true, row: r, items: (await tryApi(() => api<Version[]>(`/publish/selectors/${r.key}/history`))) ?? [] });
}

async function edit(r: SelectorRow) {
  const res = await ElMessageBox.prompt(`Selector Playwright cho "${r.label}"`, 'Sửa bộ chọn', { inputValue: r.current, inputType: 'textarea' }).catch(() => undefined);
  if (res?.value && (await tryApi(() => api(`/publish/selectors/${r.key}`, { method: 'PUT', body: { value: res.value, reason: 'Sửa tay' } }), 'Đã lưu'))) load();
}
async function revert(r: SelectorRow) {
  const ok = await ElMessageBox.confirm(`Khôi phục "${r.label}" về giá trị mặc định?`, 'Khôi phục', { type: 'warning' }).catch(() => false);
  if (ok && (await tryApi(() => api(`/publish/selectors/${r.key}/revert`, { method: 'POST' }), 'Đã khôi phục'))) load();
}

const fix = reactive({ open: false, row: null as SelectorRow | null, profileId: '', kind: 'self' as 'self' | 'page' | 'group', url: '', busy: false, result: null as null | { ok: boolean; message: string; value?: string; reason?: string } });
function openFix(r: SelectorRow) {
  Object.assign(fix, { open: true, row: r, profileId: profiles.value[0]?._id ?? '', kind: 'self', url: '', result: null });
}
async function runFix() {
  fix.busy = true;
  fix.result = (await tryApi(() => api<typeof fix.result>(`/publish/selectors/${fix.row!.key}/ai-fix`, { method: 'POST', body: { profileId: fix.profileId, kind: fix.kind, url: fix.url || undefined } }))) ?? null;
  fix.busy = false;
  load();
}
</script>

<template>
  <div class="page">
    <PageHeader title="Đăng bài" subtitle="Bộ đăng: các bộ chọn (selector) mà tool dùng để thao tác trên Facebook / Threads. Khi trang đổi giao diện, AI tự sửa và mọi thay đổi được ghi lại." />
    <PublishTabs />

    <el-alert type="info" :closable="false" show-icon class="!items-start">
      <template #title>
        Khi một lượt đăng lỗi <b>trước khi bấm Đăng</b> vì không tìm thấy nút / ô cần dùng, AI tự mở lại trang bằng đúng profile, đề xuất bộ chọn mới, kiểm tra trên
        trang thật (chỉ tìm, không bấm Đăng), lưu thành phiên bản mới rồi đăng lại. Tối đa 3 lần sửa mỗi bộ chọn mỗi ngày. Xem lịch sử từng bộ chọn hoặc trong
        <NuxtLink to="/activity?category=selector">Nhật ký hoạt động</NuxtLink>.
      </template>
    </el-alert>

    <el-card shadow="never" body-class="!p-0">
      <el-table :data="rows" size="small">
        <el-table-column label="Bộ chọn" min-width="230">
          <template #default="{ row }">
            <div class="font-medium">{{ row.label }}</div>
            <div class="text-xs text-slate-400">{{ row.key }}</div>
          </template>
        </el-table-column>
        <el-table-column label="Đang dùng" min-width="380">
          <template #default="{ row }">
            <code class="block max-h-16 overflow-auto whitespace-pre-wrap break-all text-xs">{{ row.current }}</code>
          </template>
        </el-table-column>
        <el-table-column label="Thay đổi gần nhất" min-width="240">
          <template #default="{ row }">
            <el-tag v-if="row.isDefault" size="small" type="info">mặc định</el-tag>
            <template v-else-if="row.lastChange">
              <el-tag size="small" :type="row.lastChange.source === 'ai' ? 'warning' : 'primary'">{{ row.lastChange.source === 'ai' ? '✨ AI sửa' : '👤 sửa tay' }}</el-tag>
              <span class="ml-1 text-xs text-slate-500">{{ fmtDate(row.lastChange.createdAt) }}</span>
              <div class="line-clamp-2 text-xs text-slate-600">{{ row.lastChange.reason }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column width="280" align="right">
          <template #default="{ row }">
            <el-button size="small" link @click="openHistory(row as SelectorRow)">Lịch sử</el-button>
            <el-button size="small" link @click="edit(row as SelectorRow)">Sửa</el-button>
            <el-button size="small" link type="warning" @click="openFix(row as SelectorRow)">✨ Nhờ AI sửa</el-button>
            <el-button v-if="!row.isDefault" size="small" link type="danger" @click="revert(row as SelectorRow)">Khôi phục</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="history.open" :title="`Lịch sử: ${history.row?.label}`" width="860px">
      <el-empty v-if="!history.items.length" description="Chưa thay đổi lần nào (đang dùng mặc định)" :image-size="50" />
      <el-timeline v-else>
        <el-timeline-item v-for="v in history.items" :key="v._id" :timestamp="fmtDate(v.createdAt)" :type="v.source === 'ai' ? 'warning' : 'primary'">
          <div class="font-medium">
            {{ v.source === 'ai' ? `✨ AI sửa${v.model ? ` (${v.model})` : ''}` : '👤 Sửa tay' }}
            <el-tag v-if="v.validated" size="small" type="success" class="ml-1">đã kiểm tra trên trang thật</el-tag>
            <NuxtLink v-if="v.taskId" :to="`/tasks/${v.taskId}`" class="ml-2 text-xs">task gây lỗi →</NuxtLink>
          </div>
          <div v-if="v.reason" class="text-sm">{{ v.reason }}</div>
          <div v-if="v.error" class="text-xs text-red-600">Lỗi: {{ v.error.slice(0, 300) }}</div>
          <div class="mt-1 text-xs text-slate-500">Trước:</div>
          <code class="block whitespace-pre-wrap break-all bg-red-50 p-1 text-xs">{{ v.previous }}</code>
          <div class="mt-1 text-xs text-slate-500">Sau:</div>
          <code class="block whitespace-pre-wrap break-all bg-emerald-50 p-1 text-xs">{{ v.value }}</code>
        </el-timeline-item>
      </el-timeline>
    </el-dialog>

    <el-dialog v-model="fix.open" :title="`Nhờ AI sửa: ${fix.row?.label}`" width="640px">
      <p class="mt-0 text-sm text-slate-600">AI mở trang bằng profile đã chọn (chỉ xem, có thể mở khung soạn), đề xuất bộ chọn mới và kiểm tra trên trang thật trước khi lưu. Không đăng gì.</p>
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="Profile">
          <el-select v-model="fix.profileId" class="w-full">
            <el-option v-for="p in profiles" :key="p._id" :value="p._id" :label="p.name" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="fix.row?.platform === 'facebook'" label="Trên trang nào">
          <el-radio-group v-model="fix.kind">
            <el-radio-button value="self">Trang cá nhân</el-radio-button>
            <el-radio-button value="page">Page</el-radio-button>
            <el-radio-button value="group">Nhóm</el-radio-button>
          </el-radio-group>
          <el-input v-if="fix.kind !== 'self'" v-model="fix.url" placeholder="Link Page / nhóm" class="mt-2" />
        </el-form-item>
      </el-form>
      <el-alert v-if="fix.result" :type="fix.result.ok ? 'success' : 'error'" :closable="false" :title="fix.result.message">
        <template v-if="fix.result.ok">
          <div class="text-sm">{{ fix.result.reason }}</div>
          <code class="mt-1 block whitespace-pre-wrap break-all text-xs">{{ fix.result.value }}</code>
        </template>
      </el-alert>
      <template #footer>
        <el-button @click="fix.open = false">Đóng</el-button>
        <el-button type="primary" :loading="fix.busy" :disabled="!fix.profileId" @click="runFix">Sửa</el-button>
      </template>
    </el-dialog>
  </div>
</template>
