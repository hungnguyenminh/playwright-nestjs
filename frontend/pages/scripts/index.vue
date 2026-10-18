<script setup lang="ts">
import type { Script } from '~/types/api';

const { api } = useApi();
const { isPhone } = useBreakpoint();
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
  <div class="page">
    <PageHeader title="Scripts" subtitle="Các kịch bản thao tác trình duyệt (DSL JSON), dùng lại trong job và luồng.">
      <template #actions>
        <el-button type="primary" @click="navigateTo('/scripts/new')">+ Script mới</el-button>
      </template>
    </PageHeader>
    <el-card shadow="never" body-class="!p-0">
      <el-table v-loading="loading" :data="scripts" @row-click="(row: any) => navigateTo(`/scripts/${row._id}`)">
        <el-table-column label="Tên" min-width="220">
          <template #default="{ row }"><span class="font-medium">{{ row.name }}</span></template>
        </el-table-column>
        <el-table-column label="Mô tả" prop="description" min-width="300" show-overflow-tooltip />
        <el-table-column label="Cập nhật" width="170">
          <template #default="{ row }">{{ fmtDate(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column width="170" align="right" :fixed="isPhone ? false : 'right'">
          <template #default="{ row }">
            <div @click.stop>
              <el-button size="small" type="primary" plain @click="navigateTo(`/jobs/new?scriptId=${row._id}`)">▶ Chạy</el-button>
              <el-button size="small" type="danger" plain @click="remove(row as Script)">Xoá</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
