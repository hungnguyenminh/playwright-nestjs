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
    'Saved',
  );
  if (res) {
    dialog.open = false;
    load();
  }
}

async function remove(p: Profile) {
  const ok = await ElMessageBox.confirm(
    `Delete profile "${p.name}" and its Chrome data (cookies, logins)?`,
    'Delete profile',
    { type: 'warning', confirmButtonText: 'Delete' },
  ).catch(() => false);
  if (!ok) return;
  await tryApi(() => api(`/profiles/${p._id}`, { method: 'DELETE' }), 'Deleted');
  load();
}

/** Opens a headed Chrome with this profile and pauses so you can log in by hand. */
async function openForLogin(p: Profile) {
  const res = await ElMessageBox.prompt('Page to open', `Open "${p.name}"`, {
    inputValue: 'https://accounts.google.com',
    confirmButtonText: 'Open Chrome',
  }).catch(() => undefined);
  if (!res) return;
  const job = await tryApi(() =>
    api<Job>('/jobs', {
      method: 'POST',
      body: {
        name: `Login: ${p.name}`,
        profileId: p._id,
        headless: false,
        stepTimeout: 60_000,
        actions: [
          { type: 'goto', url: res.value },
          { type: 'pause', message: 'Log in in the Chrome window, then press Resume to save and close.' },
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
      subtitle="Mỗi profile là một thư mục dữ liệu Chrome riêng: giữ cookie và đăng nhập giữa các lần chạy, mỗi lúc một task."
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
        <el-table-column label="Proxy" min-width="160">
          <template #default="{ row }">{{ row.proxy?.server ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="Dùng lần cuối" width="170">
          <template #default="{ row }">{{ row.lastUsedAt ? fmtDate(row.lastUsedAt) : '—' }}</template>
        </el-table-column>
        <el-table-column label="" width="90">
          <template #default="{ row }"><el-tag v-if="row.inUse" size="small" type="warning">đang dùng</el-tag></template>
        </el-table-column>
        <el-table-column width="290" align="right" :fixed="isPhone ? false : 'right'">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain :disabled="row.inUse" @click="openForLogin(row as Profile)">Mở để đăng nhập</el-button>
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
        <el-form-item label="Name"><el-input v-model="dialog.name" /></el-form-item>
        <el-form-item label="Notes"><el-input v-model="dialog.notes" /></el-form-item>
        <el-form-item label="Proxy server (optional)">
          <el-input v-model="dialog.proxyServer" placeholder="http://host:port or socks5://host:port" />
        </el-form-item>
        <div v-if="dialog.proxyServer" class="grid grid-cols-2 gap-3">
          <el-form-item label="Proxy user"><el-input v-model="dialog.proxyUser" /></el-form-item>
          <el-form-item label="Proxy password"><el-input v-model="dialog.proxyPass" type="password" show-password /></el-form-item>
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
        <el-button @click="dialog.open = false">Cancel</el-button>
        <el-button type="primary" @click="save">Save</el-button>
      </template>
    </el-dialog>
  </div>
</template>
