<script setup lang="ts">
import type { Job, Profile } from '~/types/api';

const { api } = useApi();
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
});

async function load() {
  loading.value = true;
  profiles.value = (await tryApi(() => api<Profile[]>('/profiles'))) ?? [];
  loading.value = false;
}
load();

function edit(p?: Profile) {
  Object.assign(dialog, {
    open: true,
    id: p?._id ?? '',
    name: p?.name ?? '',
    notes: p?.notes ?? '',
    proxyServer: p?.proxy?.server ?? '',
    proxyUser: p?.proxy?.username ?? '',
    proxyPass: p?.proxy?.password ?? '',
    emulationText: JSON.stringify(p?.emulation ?? {}, null, 2),
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
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="m-0 text-xl font-semibold">Chrome profiles</h1>
      <el-button type="primary" @click="edit()">New profile</el-button>
    </div>
    <el-alert type="info" :closable="false" show-icon>
      A profile is a separate Chrome user-data folder: cookies and logins persist between jobs. Each profile runs in its own
      Chrome process, one task at a time. Do not point it at your everyday Chrome profile.
    </el-alert>

    <el-card shadow="never">
      <el-table v-loading="loading" :data="profiles">
        <el-table-column label="Name" prop="name" min-width="160" />
        <el-table-column label="Notes" prop="notes" min-width="200" show-overflow-tooltip />
        <el-table-column label="Proxy" min-width="160">
          <template #default="{ row }">{{ row.proxy?.server ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="Last used" width="180">
          <template #default="{ row }">{{ row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : '—' }}</template>
        </el-table-column>
        <el-table-column label="" width="90">
          <template #default="{ row }"><el-tag v-if="row.inUse" size="small" type="warning">in use</el-tag></template>
        </el-table-column>
        <el-table-column width="290" align="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain :disabled="row.inUse" @click="openForLogin(row as Profile)">Open to log in</el-button>
            <el-button size="small" @click="edit(row as Profile)">Edit</el-button>
            <el-button size="small" type="danger" plain :disabled="row.inUse" @click="remove(row as Profile)">Delete</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialog.open" :title="dialog.id ? 'Edit profile' : 'New profile'" width="560px">
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
