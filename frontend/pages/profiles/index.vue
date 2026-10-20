<script setup lang="ts">
import type { Job, Profile } from '~/types/api';

const { api } = useApi();
const { isPhone } = useBreakpoint();
const profiles = ref<Profile[]>([]);
const loading = ref(false);

const dialog = reactive({
  open: false,
  id: '' as string,
  name: '',
  notes: '',
  proxyServer: '',
  proxyUser: '',
  proxyPass: '',
  emulationText: '{}',
  mode: 'folder' as Profile['mode'],
  /** Open with the AI assistant expanded. */
  ai: false,
  /** Remounts the assistant (fresh conversation) each time the dialog opens. */
  session: 0,
});

async function load() {
  loading.value = true;
  profiles.value = (await tryApi(() => api<Profile[]>('/profiles'))) ?? [];
  loading.value = false;
}
load();

function edit(p?: Profile, ai = false) {
  Object.assign(dialog, {
    open: true,
    id: p?._id ?? '',
    name: p?.name ?? '',
    notes: p?.notes ?? '',
    proxyServer: p?.proxy?.server ?? '',
    proxyUser: p?.proxy?.username ?? '',
    proxyPass: p?.proxy?.password ?? '',
    emulationText: JSON.stringify(p?.emulation ?? {}, null, 2),
    mode: p?.mode ?? 'folder',
    ai,
    session: dialog.session + 1,
  });
}

function currentProfileForm(): Record<string, unknown> {
  if (!dialog.id && !dialog.name && !dialog.proxyServer && dialog.emulationText.trim() === '{}') return {};
  let emulation: unknown = dialog.emulationText;
  try {
    emulation = JSON.parse(dialog.emulationText);
  } catch {
    // keep the raw text so the AI can see (and fix) it
  }
  return {
    name: dialog.name,
    notes: dialog.notes,
    proxy: dialog.proxyServer ? { server: dialog.proxyServer, username: dialog.proxyUser, password: dialog.proxyPass ? '(set)' : '' } : null,
    emulation,
  };
}

function applyProfileAi(p: Record<string, any>) {
  Object.assign(dialog, {
    name: p.name || dialog.name,
    notes: p.notes ?? dialog.notes,
    proxyServer: p.proxy?.server ?? '',
    proxyUser: p.proxy?.username ?? '',
    // Never overwrite a password the user typed with an empty AI value.
    proxyPass: p.proxy?.password || dialog.proxyPass,
    emulationText: JSON.stringify(p.emulation ?? {}, null, 2),
  });
}

async function save() {
  let emulation;
  try {
    emulation = JSON.parse(dialog.emulationText || '{}');
  } catch (err) {
    return ElMessage.error(`Emulation: ${(err as Error).message}`);
  }
  const body = {
    name: dialog.name,
    notes: dialog.notes,
    mode: dialog.mode,
    emulation,
    proxy: dialog.proxyServer
      ? { server: dialog.proxyServer, username: dialog.proxyUser || undefined, password: dialog.proxyPass || undefined }
      : null,
  };
  const res = await tryApi(
    () =>
      dialog.id
        ? api(`/profiles/${dialog.id}`, { method: 'PUT', body })
        : api('/profiles', { method: 'POST', body }),
    'Đã lưu',
  );
  if (res) {
    dialog.open = false;
    load();
  }
}

/** Publishing skips accounts marked "needs to log in again"; clear it after logging in. */
async function clearHealth(p: Profile) {
  const ok = await ElMessageBox.confirm(`Đã đăng nhập lại "${p.name}"? Profile sẽ được dùng lại trong các lịch đăng.`, 'Bỏ đánh dấu', { confirmButtonText: 'Đã đăng nhập' }).catch(() => false);
  if (ok && (await tryApi(() => api(`/profiles/${p._id}/health/clear`, { method: 'POST' }).then(() => true), 'Đã bỏ đánh dấu'))) p.health = undefined;
}

async function remove(p: Profile) {
  const ok = await ElMessageBox.confirm(
    `Xoá profile "${p.name}" cùng toàn bộ dữ liệu Chrome và phiên đăng nhập của nó?`,
    'Xoá profile',
    { type: 'warning', confirmButtonText: 'Xoá' },
  ).catch(() => false);
  if (!ok) return;
  await tryApi(() => api(`/profiles/${p._id}`, { method: 'DELETE' }), 'Đã xoá');
  load();
}

/** Folder → database: copies cookies + localStorage out of the Chrome folder. */
async function importSession(p: Profile) {
  const ok = await ElMessageBox.confirm(
    `Chép cookie và localStorage từ thư mục Chrome của "${p.name}" vào database (mã hoá), rồi chuyển profile sang chế độ "Phiên trong DB" để chạy song song? Thư mục Chrome vẫn được giữ.`,
    'Chuyển phiên vào DB',
    { confirmButtonText: 'Chuyển', type: 'info' },
  ).catch(() => false);
  if (!ok) return;
  if (await tryApi(() => api(`/profiles/${p._id}/import-session`, { method: 'POST' }), 'Đã chuyển phiên vào database')) load();
}

async function clearSession(p: Profile) {
  const ok = await ElMessageBox.confirm(`Xoá phiên đăng nhập đã lưu của "${p.name}"? Lần chạy sau sẽ như chưa đăng nhập.`, 'Xoá phiên', {
    type: 'warning',
    confirmButtonText: 'Xoá phiên',
  }).catch(() => false);
  if (!ok) return;
  if (await tryApi(() => api(`/profiles/${p._id}/session`, { method: 'DELETE' }), 'Đã xoá phiên')) load();
}

/** Opens a headed Chrome with this profile and pauses so you can log in by hand. */
async function openForLogin(p: Profile) {
  const res = await ElMessageBox.prompt('Trang cần đăng nhập (lần sau sẽ tự điền lại)', `Mở Chrome với profile "${p.name}"`, {
    inputValue: p.loginUrl || 'https://',
    inputPattern: /^https?:\/\/\S+\.\S+/,
    inputErrorMessage: 'Nhập địa chỉ đầy đủ, ví dụ https://www.facebook.com',
    confirmButtonText: 'Mở Chrome',
    cancelButtonText: 'Huỷ',
  }).catch(() => undefined);
  if (!res) return;
  const url = res.value.trim();
  // Remember it for next time (only name is required by the API).
  if (url !== p.loginUrl) {
    await api(`/profiles/${p._id}`, { method: 'PUT', body: { name: p.name, loginUrl: url } }).catch(() => undefined);
    p.loginUrl = url;
  }
  const job = await tryApi(() =>
    api<Job>('/jobs', {
      method: 'POST',
      body: {
        name: `Login: ${p.name}`,
        category: 'login',
        profileId: p._id,
        headless: false,
        stepTimeout: 60_000,
        actions: [
          { type: 'goto', url },
          { type: 'pause', message: 'Đăng nhập trong cửa sổ Chrome, xong thì bấm Resume để lưu.' },
        ],
      },
    }),
  );
  if (!job) return;
  const { items } = await api<{ items: { _id: string }[] }>(`/jobs/${job._id}/tasks`);
  navigateTo(`/tasks/${items[0]._id}`);
}
</script>

<template>
  <div class="page">
    <PageHeader
      title="Chrome profiles"
      subtitle="Profile giữ phiên đăng nhập giữa các lần chạy: trong thư mục Chrome riêng (đầy đủ, 1 task mỗi lúc) hoặc trong database (chạy song song)."
    >
      <template #actions>
        <el-button color="#7c3aed" plain @click="edit(undefined, true)">✨ Tạo bằng AI</el-button>
        <el-button type="primary" @click="edit()">+ Profile mới</el-button>
      </template>
    </PageHeader>

    <el-card shadow="never" body-class="!p-0">
      <el-table v-loading="loading" :data="profiles">
        <el-table-column label="Tên" min-width="160">
          <template #default="{ row }"><span class="font-medium">{{ row.name }}</span></template>
        </el-table-column>
        <el-table-column label="Ghi chú" prop="notes" min-width="200" show-overflow-tooltip />
        <el-table-column label="Lưu phiên" min-width="190">
          <template #default="{ row }">
            <div v-if="row.mode === 'session'">
              <el-tag size="small" type="primary" disable-transitions>Trong DB · chạy song song</el-tag>
              <div class="mt-0.5 text-xs text-slate-500">
                {{ row.sessionCookies ? `${row.sessionCookies} cookie · ${fmtDate(row.sessionUpdatedAt)}` : 'chưa có phiên: mở để đăng nhập' }}
              </div>
            </div>
            <div v-else>
              <el-tag size="small" type="info" disable-transitions>Thư mục Chrome</el-tag>
              <div class="mt-0.5 text-xs text-slate-500">1 task mỗi lúc</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="Proxy" min-width="160">
          <template #default="{ row }">{{ row.proxy?.server ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="Dùng lần cuối" width="170">
          <template #default="{ row }">{{ row.lastUsedAt ? fmtDate(row.lastUsedAt) : '—' }}</template>
        </el-table-column>
        <el-table-column label="" width="150">
          <template #default="{ row }">
            <el-tag v-if="row.inUse" size="small" type="warning">đang dùng</el-tag>
            <el-tooltip v-if="row.health?.needsLogin" :content="`${row.health.lastError ?? ''} · đăng nhập lại rồi bấm để bỏ đánh dấu`">
              <el-tag size="small" type="danger" class="cursor-pointer" @click="clearHealth(row as Profile)">cần đăng nhập lại ✕</el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column width="330" align="right" :fixed="isPhone ? false : 'right'">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain :disabled="row.inUse" @click="openForLogin(row as Profile)">Mở để đăng nhập</el-button>
            <el-dropdown trigger="click" class="ml-2" @command="(c: string) => (c === 'import' ? importSession(row as Profile) : clearSession(row as Profile))">
              <el-button size="small">Phiên ▾</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="import" :disabled="row.inUse">Chuyển phiên từ thư mục vào DB</el-dropdown-item>
                  <el-dropdown-item command="clear" :disabled="row.mode !== 'session' || !row.sessionCookies">Xoá phiên trong DB</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button size="small" @click="edit(row as Profile)">Sửa</el-button>
            <el-button size="small" type="danger" plain :disabled="row.inUse" @click="remove(row as Profile)">Xoá</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialog.open" :title="dialog.id ? 'Sửa profile' : 'Profile mới'" :width="dialog.ai ? '820px' : '600px'" top="6vh">
      <AiAssistPanel
        :key="dialog.session"
        kind="profile"
        class="!mb-4"
        :current-form="currentProfileForm"
        :start-open="dialog.ai"
        placeholder="Ví dụ: profile cho tài khoản Shopee thứ 2, dùng proxy Việt Nam, tiếng Việt, màn hình 1440x900"
        @accept="applyProfileAi"
      />
      <el-form label-position="top">
        <el-form-item label="Tên"><el-input v-model="dialog.name" /></el-form-item>
        <el-form-item label="Ghi chú"><el-input v-model="dialog.notes" /></el-form-item>
        <el-form-item label="Lưu phiên đăng nhập ở đâu">
          <el-radio-group v-model="dialog.mode" class="!flex !flex-col !items-start gap-1">
            <el-radio value="folder">
              <b>Thư mục Chrome</b>
              <span class="ml-1 text-xs text-slate-500">giữ đủ mọi thứ (cookie, IndexedDB, cache…), 1 task mỗi lúc</span>
            </el-radio>
            <el-radio value="session">
              <b>Trong database</b>
              <span class="ml-1 text-xs text-slate-500">cookie + localStorage mã hoá, nhiều task chạy song song</span>
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="Proxy server (không bắt buộc)">
          <el-input v-model="dialog.proxyServer" placeholder="http://host:port or socks5://host:port" />
        </el-form-item>
        <div v-if="dialog.proxyServer" class="grid grid-cols-2 gap-3">
          <el-form-item label="Tài khoản proxy"><el-input v-model="dialog.proxyUser" /></el-form-item>
          <el-form-item label="Mật khẩu proxy"><el-input v-model="dialog.proxyPass" type="password" show-password /></el-form-item>
        </div>
        <el-form-item label="Emulation (JSON)">
          <el-input
            v-model="dialog.emulationText"
            type="textarea"
            :rows="5"
            class="font-mono"
            placeholder='{ "locale": "vi-VN", "timezoneId": "Asia/Ho_Chi_Minh", "viewport": { "width": 1440, "height": 900 } }'
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.open = false">Huỷ</el-button>
        <el-button type="primary" @click="save">Lưu</el-button>
      </template>
    </el-dialog>
  </div>
</template>
