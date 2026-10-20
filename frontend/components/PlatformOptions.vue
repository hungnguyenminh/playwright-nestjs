<script setup lang="ts">
import type { Media, PlatformInfo, PlatformOptions, PostCheck } from '~/types/api';

/** Format and options of one platform for a post, with the live check result. */
const model = defineModel<PlatformOptions>({ required: true });
const props = defineProps<{ info: PlatformInfo; check?: PostCheck; media: Media[]; sharedContent: string }>();
const { base } = useApi();

const p = computed(() => props.info.platform);
const formatLabel = (v?: string | null) => props.info.formats.find((f) => f.value === v)?.label ?? v ?? '—';
const images = computed(() => props.media.filter((m) => m.kind === 'image'));

/** Text field that overrides the shared content on this platform. */
const overrideKey = computed<'content' | 'description' | 'caption'>(() =>
  p.value === 'youtube' ? 'description' : p.value === 'tiktok' ? 'caption' : 'content',
);
const override = computed({
  get: () => model.value[overrideKey.value] ?? '',
  set: (v: string) => (model.value = { ...model.value, [overrideKey.value]: v || undefined }),
});
const set = <K extends keyof PlatformOptions>(k: K, v: PlatformOptions[K]) => (model.value = { ...model.value, [k]: v });

const isChain = computed(() => p.value === 'threads' && model.value.format === 'chain');
const parts = computed(() => (model.value.parts?.length ? model.value.parts : ['', '']));
function setPart(i: number, v: string) {
  const next = [...parts.value];
  next[i] = v;
  set('parts', next);
}
const addPart = () => set('parts', [...parts.value, '']);
const removePart = (i: number) => set('parts', parts.value.filter((_, k) => k !== i));

const countText = (key: string) => {
  const c = props.check?.counts[key];
  return c ? `${c.used}/${c.max}` : '';
};
const over = (key: string) => {
  const c = props.check?.counts[key];
  return !!c && c.used > c.max;
};
</script>

<template>
  <div class="space-y-3">
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="Dạng bài">
        <el-select :model-value="model.format ?? 'auto'" class="!w-72" @update:model-value="(v: string) => set('format', v === 'auto' ? undefined : v)">
          <el-option value="auto" :label="`Tự đoán theo media${check?.auto && check.format ? ` → ${formatLabel(check.format)}` : ''}`" />
          <el-option v-for="f in info.formats" :key="f.value" :value="f.value" :label="f.label">
            <span>{{ f.label }}</span><span class="ml-2 text-xs text-slate-400">{{ f.hint }}</span>
          </el-option>
        </el-select>
      </el-form-item>

      <el-form-item v-if="p === 'youtube'" label="Tiêu đề video">
        <el-input :model-value="model.title" placeholder="Để trống = dùng tên bài" @update:model-value="(v: string) => set('title', v || undefined)" />
        <div class="text-xs" :class="over('title') ? 'text-red-600' : 'text-slate-400'">{{ countText('title') }}</div>
      </el-form-item>

      <el-form-item v-if="!isChain" :label="p === 'youtube' ? 'Mô tả riêng cho YouTube' : p === 'tiktok' ? 'Caption riêng cho TikTok' : `Nội dung riêng cho ${info.label}`">
        <el-input v-model="override" type="textarea" :autosize="{ minRows: 2, maxRows: 10 }" :placeholder="`Để trống = dùng nội dung chung${sharedContent ? '' : ' (đang trống)'}`" />
      </el-form-item>

      <template v-if="isChain">
        <div class="mb-1 text-sm text-slate-600">Các đoạn của chuỗi thread (mỗi đoạn tối đa {{ info.limits.partMax }} ký tự):</div>
        <div v-for="(part, i) in parts" :key="i" class="mb-2 flex items-start gap-2">
          <span class="mt-1 w-6 text-right text-xs text-slate-400">{{ i + 1 }}.</span>
          <div class="flex-1">
            <el-input :model-value="part" type="textarea" :autosize="{ minRows: 2, maxRows: 8 }" @update:model-value="(v: string) => setPart(i, v)" />
            <div class="text-xs" :class="over(`part${i + 1}`) ? 'text-red-600' : 'text-slate-400'">{{ countText(`part${i + 1}`) }}</div>
          </div>
          <el-button link type="danger" :disabled="parts.length <= 2" @click="removePart(i)">Xoá</el-button>
        </div>
        <el-button size="small" @click="addPart">+ Thêm đoạn</el-button>
      </template>

      <div class="grid grid-cols-1 gap-x-4 md:grid-cols-2">
        <el-form-item v-if="info.options.privacy" :label="info.options.privacy.label">
          <el-select :model-value="model.privacy" placeholder="Mặc định" clearable @update:model-value="(v: string) => set('privacy', v || undefined)">
            <el-option v-for="o in info.options.privacy.values" :key="o.value" :value="o.value" :label="o.label" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="info.options.replyControl" :label="info.options.replyControl.label">
          <el-select :model-value="model.replyControl" placeholder="Mặc định" clearable @update:model-value="(v: string) => set('replyControl', v || undefined)">
            <el-option v-for="o in info.options.replyControl.values" :key="o.value" :value="o.value" :label="o.label" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="p === 'threads'" label="Chủ đề (topic)">
          <el-input :model-value="model.topic" placeholder="vd Công nghệ" @update:model-value="(v: string) => set('topic', v || undefined)" />
        </el-form-item>

        <template v-if="p === 'youtube'">
          <el-form-item label="Tags">
            <el-select :model-value="model.tags ?? []" multiple filterable allow-create default-first-option :reserve-keyword="false" placeholder="Gõ rồi Enter" @update:model-value="(v: string[]) => set('tags', v)" />
            <div class="text-xs" :class="over('tags') ? 'text-red-600' : 'text-slate-400'">{{ countText('tags') }}</div>
          </el-form-item>
          <el-form-item label="Playlist">
            <el-input :model-value="model.playlist" placeholder="Tên playlist có sẵn" @update:model-value="(v: string) => set('playlist', v || undefined)" />
          </el-form-item>
          <el-form-item label="Dành cho trẻ em">
            <el-switch :model-value="!!model.madeForKids" active-text="Có" inactive-text="Không" @update:model-value="(v: unknown) => set('madeForKids', !!v)" />
          </el-form-item>
          <el-form-item label="Hẹn giờ công chiếu trên YouTube">
            <el-date-picker :model-value="model.premiereAt" type="datetime" placeholder="Không hẹn" @update:model-value="(v: Date | null) => set('premiereAt', v ? new Date(v).toISOString() : undefined)" />
          </el-form-item>
        </template>

        <el-form-item v-if="(p === 'youtube' || p === 'tiktok') && images.length" :label="p === 'youtube' ? 'Thumbnail' : 'Ảnh bìa'">
          <el-select
            :model-value="p === 'youtube' ? model.thumbnailId : model.coverId"
            clearable
            placeholder="Mặc định"
            @update:model-value="(v: string) => set(p === 'youtube' ? 'thumbnailId' : 'coverId', v || undefined)"
          >
            <el-option v-for="(m, i) in images" :key="m._id" :value="m._id" :label="`Ảnh ${i + 1}: ${m.name}`">
              <span class="flex items-center gap-2"><img :src="`${base}/media/${m._id}/file`" class="h-6 w-8 object-cover" />{{ m.name }}</span>
            </el-option>
          </el-select>
        </el-form-item>

        <template v-if="p === 'tiktok'">
          <el-form-item label="Cho phép">
            <el-checkbox :model-value="model.allowComment !== false" @update:model-value="(v: unknown) => set('allowComment', !!v)">Bình luận</el-checkbox>
            <el-checkbox :model-value="model.allowDuet !== false" @update:model-value="(v: unknown) => set('allowDuet', !!v)">Duet</el-checkbox>
            <el-checkbox :model-value="model.allowStitch !== false" @update:model-value="(v: unknown) => set('allowStitch', !!v)">Stitch</el-checkbox>
          </el-form-item>
        </template>
      </div>

      <el-form-item v-if="p === 'facebook'" :label="info.options.firstComment.label">
        <el-input :model-value="model.firstComment" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" @update:model-value="(v: string) => set('firstComment', v || undefined)" />
      </el-form-item>
    </el-form>

    <div v-if="check" class="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div class="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span>
          Sẽ đăng dạng <b class="text-slate-700">{{ formatLabel(check.format) }}</b>{{ check.auto && check.format ? ' (tự đoán)' : '' }}
        </span>
        <span v-if="check.counts.text" :class="over('text') ? 'text-red-600' : ''">{{ countText('text') }} ký tự</span>
      </div>
      <pre v-if="!isChain" class="m-0 max-h-48 overflow-auto whitespace-pre-wrap text-sm text-slate-800">{{ check.text || '(không có chữ)' }}</pre>
      <ul v-if="check.errors.length" class="mb-0 mt-2 pl-5 text-sm text-red-600">
        <li v-for="e in check.errors" :key="e">{{ e }}</li>
      </ul>
      <ul v-if="check.warnings.length" class="mb-0 mt-2 pl-5 text-sm text-amber-600">
        <li v-for="w in check.warnings" :key="w">{{ w }}</li>
      </ul>
      <div v-if="!check.errors.length" class="mt-2 text-sm text-emerald-600">✓ Hợp lệ với {{ info.label }}</div>
    </div>
  </div>
</template>
