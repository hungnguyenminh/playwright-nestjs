<script setup lang="ts">
/**
 * A task result made readable: each list of objects becomes a table, plain
 * values become key/value rows; the raw JSON stays one tab away.
 */
const props = defineProps<{ result?: Record<string, unknown> | null }>();

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const tables = computed(() =>
  Object.entries(props.result ?? {})
    .filter(([, v]) => Array.isArray(v) && v.length && v.every(isPlain))
    .map(([name, v]) => {
      const rows = v as Record<string, unknown>[];
      return { name, rows, columns: [...new Set(rows.slice(0, 100).flatMap((r) => Object.keys(r)))] };
    }),
);
const values = computed(() =>
  Object.entries(props.result ?? {}).filter(([k]) => !tables.value.some((t) => t.name === k)),
);
const tab = ref('');
watch(
  tables,
  (t) => {
    if (!tab.value || tab.value === 'json') tab.value = t[0]?.name ?? (values.value.length ? 'values' : 'json');
  },
  { immediate: true },
);

const cell = (v: unknown) => {
  if (v === null || v === undefined || (Array.isArray(v) && !v.length)) return '';
  if (Array.isArray(v)) return `${v.length} mục`;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};
const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v);
</script>

<template>
  <div v-if="!props.result || !Object.keys(props.result).length" class="py-6 text-center text-sm text-slate-400">Chưa có kết quả</div>
  <el-tabs v-else v-model="tab" class="result-tabs">
    <el-tab-pane v-for="t in tables" :key="t.name" :name="t.name">
      <template #label>{{ t.name }} <span class="ml-1 rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-500">{{ t.rows.length }}</span></template>
      <el-table :data="t.rows.slice(0, 200)" size="small" max-height="420" border>
        <el-table-column type="index" width="46" />
        <el-table-column v-for="c in t.columns" :key="c" :label="c" min-width="140">
          <template #default="{ row }">
            <a v-if="isUrl(row[c])" :href="row[c]" target="_blank" rel="noopener" class="line-clamp-1 break-all">{{ row[c] }}</a>
            <span v-else class="line-clamp-3 whitespace-pre-line break-words" :title="cell(row[c])">{{ cell(row[c]) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="t.rows.length > 200" class="mt-1 text-xs text-slate-400">Hiển thị 200 / {{ t.rows.length }} dòng; xem đủ ở trang Dữ liệu.</div>
    </el-tab-pane>
    <el-tab-pane v-if="values.length" label="Giá trị" name="values">
      <div class="divide-y divide-slate-100 rounded-lg border border-slate-100">
        <div v-for="[k, v] in values" :key="k" class="flex gap-4 px-3 py-2 text-sm">
          <span class="w-36 shrink-0 font-medium text-slate-500">{{ k }}</span>
          <span class="min-w-0 break-words">{{ cell(v) }}</span>
        </div>
      </div>
    </el-tab-pane>
    <el-tab-pane label="JSON" name="json">
      <pre class="m-0 max-h-96 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">{{ JSON.stringify(props.result, null, 2) }}</pre>
    </el-tab-pane>
  </el-tabs>
</template>

<style scoped>
.result-tabs :deep(.el-tabs__header) {
  margin-bottom: 10px;
}
</style>
