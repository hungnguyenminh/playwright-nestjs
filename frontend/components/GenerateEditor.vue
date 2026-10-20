<script setup lang="ts">
import type { GenerateSpec, Platform } from '~/types/api';

/** How the AI turns new data rows into posts (crawl → publish flows, Data page "Tạo bài"). */
const model = defineModel<GenerateSpec>({ required: true });
defineProps<{ showLimit?: boolean }>();

const PLATFORMS: Platform[] = ['facebook', 'threads', 'tiktok', 'youtube'];
function togglePlatform(p: Platform, on: unknown) {
  model.value.platforms = on ? [...new Set([...model.value.platforms, p])] : model.value.platforms.filter((x) => x !== p);
}
const filterQ = computed({
  get: () => model.value.filter?.q ?? '',
  set: (q: string) => (model.value.filter = { ...model.value.filter, q: q || undefined }),
});
const requireImage = computed({
  get: () => !!model.value.filter?.requireImage,
  set: (v: boolean) => (model.value.filter = { ...model.value.filter, requireImage: v || undefined }),
});
</script>

<template>
  <el-form label-position="top" @submit.prevent>
    <el-form-item label="Yêu cầu cho AI (giọng văn, nội dung cần nhấn mạnh…)">
      <el-input
        v-model="model.prompt"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 8 }"
        placeholder="Ví dụ: Viết bài giới thiệu sản phẩm ngắn gọn, vui vẻ, nêu giá và 1–2 điểm nổi bật, kết bằng lời mời inbox."
      />
      <div class="text-xs text-slate-500">AI chỉ dùng thông tin có trong dữ liệu (không bịa giá, ngày, khuyến mãi) và viết văn bản thuần, không markdown.</div>
    </el-form-item>

    <el-form-item label="Viết cho nền tảng">
      <el-checkbox v-for="p in PLATFORMS" :key="p" :model-value="model.platforms.includes(p)" @update:model-value="(v) => togglePlatform(p, v)">
        {{ PLATFORM_ICON[p] }} {{ PLATFORM_LABEL[p] }}
      </el-checkbox>
      <div v-if="model.platforms.includes('youtube')" class="text-xs text-amber-600">YouTube cần video: bài AI chỉ có chữ / ảnh nên sẽ chờ bạn gắn video khi duyệt.</div>
      <div v-if="model.platforms.includes('tiktok') && !model.attachImage" class="text-xs text-amber-600">TikTok cần ảnh hoặc video: nên bật "Gắn ảnh của dòng dữ liệu".</div>
    </el-form-item>

    <div class="grid grid-cols-1 gap-x-6 md:grid-cols-3">
      <el-form-item label="Cách viết">
        <el-radio-group v-model="model.mode">
          <el-radio value="perRecord">Mỗi dòng dữ liệu một bài</el-radio>
          <el-radio value="digest">Gộp nhiều dòng thành 1 bài tổng hợp</el-radio>
        </el-radio-group>
        <div v-if="model.mode === 'digest'" class="mt-1 flex items-center gap-2 text-sm">
          <el-input-number v-model="model.digestSize" :min="2" :max="20" size="small" class="!w-24" /> dòng / bài (vd "Top 5…")
        </div>
      </el-form-item>
      <el-form-item label="Độ dài">
        <el-radio-group v-model="model.length">
          <el-radio value="short">Ngắn</el-radio>
          <el-radio value="medium">Vừa</el-radio>
          <el-radio value="long">Dài</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="Giọng văn (không bắt buộc)">
        <el-input v-model="model.tone" placeholder="vui vẻ, chuyên nghiệp, thân thiện…" />
      </el-form-item>
    </div>

    <div class="grid grid-cols-1 gap-x-6 md:grid-cols-3">
      <el-form-item v-if="showLimit" label="Số bài tối đa mỗi lần kéo">
        <el-input-number v-model="model.maxPostsPerRun" :min="1" :max="50" />
      </el-form-item>
      <el-form-item label="Ảnh">
        <el-checkbox v-model="model.attachImage">Gắn ảnh của dòng dữ liệu (trường image)</el-checkbox>
        <el-checkbox v-if="showLimit" v-model="requireImage">Chỉ viết từ dòng có ảnh</el-checkbox>
      </el-form-item>
      <el-form-item label="Duyệt bài">
        <el-radio-group v-model="model.approval">
          <el-radio value="review">Chờ tôi duyệt (bài vào Nháp)</el-radio>
          <el-radio value="auto">Tự duyệt, đăng theo lịch</el-radio>
        </el-radio-group>
      </el-form-item>
    </div>

    <el-form-item v-if="showLimit" label="Chỉ viết từ dòng chứa từ (không bắt buộc)">
      <el-input v-model="filterQ" placeholder="vd: giảm giá" class="max-w-sm" />
    </el-form-item>
  </el-form>
</template>
