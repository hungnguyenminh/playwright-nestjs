<script setup lang="ts">
import type { Script } from '~/types/api';

const { api } = useApi();
const scripts = ref<Script[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  scripts.value = (await tryApi(() => api<Script[]>('/scripts'))) ?? [];
  loading.value = false;
}
load();

async function remove(s: Script) {
  const ok = await ElMessageBox.confirm(`Delete script "${s.name}"?`, 'Delete script', {
    type: 'warning',
    confirmButtonText: 'Delete',
  }).catch(() => false);
  if (!ok) return;
  await tryApi(() => api(`/scripts/${s._id}`, { method: 'DELETE' }), 'Deleted');
  load();
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="m-0 text-xl font-semibold">Scripts</h1>
      <el-button type="primary" @click="navigateTo('/scripts/new')">New script</el-button>
    </div>
    <el-card shadow="never">
      <el-table v-loading="loading" :data="scripts" @row-click="(row: any) => navigateTo(`/scripts/${row._id}`)">
        <el-table-column label="Name" prop="name" min-width="200" />
        <el-table-column label="Description" prop="description" min-width="300" show-overflow-tooltip />
        <el-table-column label="Updated" width="180">
          <template #default="{ row }">{{ new Date(row.updatedAt).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column width="200" align="right">
          <template #default="{ row }">
            <div @click.stop>
              <el-button size="small" type="primary" plain @click="navigateTo(`/jobs/new?scriptId=${row._id}`)">Run</el-button>
              <el-button size="small" type="danger" plain @click="remove(row as Script)">Delete</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
