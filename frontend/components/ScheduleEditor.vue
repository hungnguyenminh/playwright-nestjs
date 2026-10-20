<script setup lang="ts">
import type { CampaignForm } from '~/types/api';

/** When to post: once, chosen times, or every N minutes / hours / days, plus spacing rules. */
const form = defineModel<CampaignForm>({ required: true });
/** Endless "every N" only (crawl → publish flows: posts keep coming). */
const props = defineProps<{ intervalOnly?: boolean }>();

const mode = computed({
  get: () => form.value.schedule.mode,
  set: (m) => {
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    form.value.schedule =
      m === 'once'
        ? { mode: 'once' }
        : m === 'slots'
          ? { mode: 'slots', slots: [{ at: soon }] }
          : { mode: 'interval', startAt: soon, every: 1, unit: 'hour', jitterMinutes: 10, activeHours: { from: '07:00', to: '23:00' } };
  },
});
const s = computed(() => form.value.schedule as any);
const endless = computed({
  get: () => s.value.count === undefined,
  set: (v: boolean) => {
    if (v) delete s.value.count;
    else s.value.count = 10;
  },
});
const useHours = computed({
  get: () => !!s.value.activeHours,
  set: (v: boolean) => (s.value.activeHours = v ? { from: '07:00', to: '23:00' } : undefined),
});
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : undefined);
</script>

<template>
  <el-form label-position="top" @submit.prevent>
    <el-form-item v-if="!props.intervalOnly" label="Đăng khi nào">
      <el-radio-group v-model="mode">
        <el-radio-button value="once">1 lần</el-radio-button>
        <el-radio-button value="slots">Chọn ngày giờ</el-radio-button>
        <el-radio-button value="interval">Định kỳ</el-radio-button>
      </el-radio-group>
    </el-form-item>

    <el-form-item v-if="s.mode === 'once'" label="Thời điểm (để trống = ngay khi kích hoạt)">
      <el-date-picker :model-value="s.at" type="datetime" placeholder="Ngay bây giờ" @update:model-value="(v: any) => (s.at = iso(v))" />
    </el-form-item>

    <template v-if="s.mode === 'slots'">
      <div v-for="(slot, i) in s.slots" :key="i" class="mb-2 flex items-center gap-2">
        <el-date-picker :model-value="slot.at" type="datetime" @update:model-value="(v: any) => (slot.at = iso(v))" />
        <el-button link type="danger" :disabled="s.slots.length <= 1" @click="s.slots.splice(i, 1)">Xoá</el-button>
      </div>
      <el-button size="small" @click="s.slots.push({ at: new Date(new Date(s.slots.at(-1)?.at ?? Date.now()).getTime() + 3_600_000).toISOString() })">+ Thêm mốc</el-button>
    </template>

    <template v-if="s.mode === 'interval'">
      <div class="flex flex-wrap gap-x-6">
        <el-form-item label="Bắt đầu">
          <el-date-picker :model-value="s.startAt" type="datetime" @update:model-value="(v: any) => (s.startAt = iso(v))" />
        </el-form-item>
        <el-form-item label="Mỗi">
          <div class="flex gap-2">
            <el-input-number v-model="s.every" :min="1" :max="1000" class="!w-28" />
            <el-select v-model="s.unit" class="!w-24">
              <el-option value="minute" label="phút" />
              <el-option value="hour" label="giờ" />
              <el-option value="day" label="ngày" />
            </el-select>
          </div>
        </el-form-item>
        <el-form-item v-if="!props.intervalOnly" label="Số lần">
          <div class="flex items-center gap-2">
            <el-checkbox v-model="endless">Không giới hạn</el-checkbox>
            <el-input-number v-if="!endless" v-model="s.count" :min="1" :max="10000" class="!w-28" />
          </div>
        </el-form-item>
        <el-form-item label="Lệch ngẫu nhiên ± (phút)">
          <el-input-number v-model="s.jitterMinutes" :min="0" :max="120" class="!w-28" />
        </el-form-item>
        <el-form-item label="Khung giờ hoạt động">
          <div class="flex items-center gap-2">
            <el-checkbox v-model="useHours">Chỉ đăng từ</el-checkbox>
            <template v-if="useHours">
              <el-time-select v-model="s.activeHours.from" start="00:00" step="00:30" end="23:30" class="!w-28" />
              <span>đến</span>
              <el-time-select v-model="s.activeHours.to" start="00:00" step="00:30" end="23:30" class="!w-28" />
            </template>
          </div>
        </el-form-item>
      </div>
    </template>

    <div class="mt-2 grid grid-cols-1 gap-x-6 md:grid-cols-3">
      <el-form-item label="Giãn cách giữa các tài khoản trong 1 lượt (phút)">
        <el-input-number v-model="form.staggerMinutes" :min="0" :max="1440" :step="15" />
      </el-form-item>
      <el-form-item label="1 tài khoản cách nhau tối thiểu, mọi nơi (phút)">
        <el-input-number v-model="form.minGapMinutes" :min="0" :max="1440" :step="15" />
      </el-form-item>
      <el-form-item label="Khi máy tắt lúc tới giờ">
        <el-radio-group v-model="form.catchUp">
          <el-radio value="shift">Đăng bù, dời cả lịch</el-radio>
          <el-radio value="skip">Bỏ qua lượt trễ</el-radio>
        </el-radio-group>
      </el-form-item>
    </div>
  </el-form>
</template>
