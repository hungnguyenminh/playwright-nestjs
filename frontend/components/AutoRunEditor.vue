<script setup lang="ts">
/** "Run by itself every N hours / days", optionally only inside some hours. */
const model = defineModel<{ enabled: boolean; every: number; unit: 'hour' | 'day'; useHours: boolean; from: string; to: string }>({ required: true });
defineProps<{ title?: string }>();
</script>

<template>
  <div class="rounded-lg border border-slate-200 p-3">
    <el-checkbox v-model="model.enabled" class="!font-medium">{{ title ?? 'Tự chạy định kỳ' }}</el-checkbox>
    <div v-if="model.enabled" class="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span>Mỗi</span>
      <el-input-number v-model="model.every" :min="1" :max="1000" size="small" class="!w-28" />
      <el-select v-model="model.unit" size="small" class="!w-24">
        <el-option value="hour" label="giờ" />
        <el-option value="day" label="ngày" />
      </el-select>
      <el-checkbox v-model="model.useHours" class="!ml-3">chỉ trong khung giờ</el-checkbox>
      <template v-if="model.useHours">
        <el-time-select v-model="model.from" start="00:00" step="00:30" end="23:30" size="small" class="!w-28" />
        <span>–</span>
        <el-time-select v-model="model.to" start="00:00" step="00:30" end="23:30" size="small" class="!w-28" />
      </template>
    </div>
    <div class="mt-1 text-xs text-slate-500">
      Máy phải đang bật và app đang chạy. Lỡ giờ (máy tắt) thì chạy bù một lần khi bật lại, rồi tiếp tục chu kỳ; lần trước chưa xong thì bỏ qua lượt đó.
    </div>
  </div>
</template>
