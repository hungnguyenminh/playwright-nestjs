<script setup lang="ts">
import type { Media } from '~/types/api';

/**
 * Media of a post, in order: upload files, download an image from a link, or
 * pick from the library. v-model holds the Media objects.
 */
const model = defineModel<Media[]>({ required: true });
const { api, base } = useApi();
const fileUrl = (m: Media) => `${base}/media/${m._id}/file`;

const uploading = ref(0);
const input = ref<HTMLInputElement>();

/** The browser knows the size / length of any video it can play (the server only reads MP4 / MOV). */
function videoHint(file: File): Promise<Record<string, number>> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (hint: Record<string, number>) => {
      URL.revokeObjectURL(url);
      resolve(hint);
    };
    v.preload = 'metadata';
    v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight, duration: Math.round(v.duration * 100) / 100 });
    v.onerror = () => done({});
    setTimeout(() => done({}), 5000);
    v.src = url;
  });
}

async function upload(files: FileList | null) {
  for (const file of Array.from(files ?? [])) {
    uploading.value++;
    const form = new FormData();
    form.append('file', file);
    if (file.type.startsWith('video/')) {
      for (const [k, v] of Object.entries(await videoHint(file))) if (Number.isFinite(v) && v > 0) form.append(k, String(v));
    }
    const m = await tryApi(() => api<Media>('/media', { method: 'POST', body: form }));
    uploading.value--;
    if (m) model.value = [...model.value, m];
  }
  if (input.value) input.value.value = '';
}

const link = ref('');
const fetching = ref(false);
async function fromUrl() {
  if (!/^https?:\/\//.test(link.value.trim())) return ElMessage.warning('Dán link ảnh bắt đầu bằng http(s)://');
  fetching.value = true;
  const m = await tryApi(() => api<Media>('/media/from-url', { method: 'POST', body: { url: link.value.trim() } }));
  fetching.value = false;
  if (m) {
    model.value = [...model.value, m];
    link.value = '';
  }
}

const library = reactive({ open: false, items: [] as Media[], picked: [] as string[] });
async function openLibrary() {
  library.open = true;
  library.picked = [];
  library.items = (await tryApi(() => api<Media[]>('/media'))) ?? [];
}
function addPicked() {
  const have = new Set(model.value.map((m) => m._id));
  model.value = [...model.value, ...library.items.filter((m) => library.picked.includes(m._id) && !have.has(m._id))];
  library.open = false;
}
function togglePick(id: string) {
  library.picked = library.picked.includes(id) ? library.picked.filter((x) => x !== id) : [...library.picked, id];
}

function move(i: number, d: number) {
  const list = [...model.value];
  const [m] = list.splice(i, 1);
  list.splice(i + d, 0, m);
  model.value = list;
}
const remove = (i: number) => (model.value = model.value.filter((_, k) => k !== i));

const describe = (m: Media) =>
  [m.width && m.height ? `${m.width}×${m.height}` : '', m.duration ? `${Math.round(m.duration)}s` : '', m.size < 1024 * 1024 ? `${Math.max(1, Math.round(m.size / 1024))} KB` : `${(m.size / 1024 / 1024).toFixed(1)} MB`]
    .filter(Boolean)
    .join(' · ');
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-2">
      <el-button :loading="uploading > 0" @click="input?.click()">⬆ Tải ảnh / video lên</el-button>
      <input ref="input" type="file" accept="image/*,video/*" multiple class="hidden" @change="upload(($event.target as HTMLInputElement).files)" />
      <el-button @click="openLibrary">Chọn từ thư viện</el-button>
      <el-input v-model="link" placeholder="hoặc dán link ảnh…" class="!w-72" @keyup.enter="fromUrl">
        <template #append><el-button :loading="fetching" @click="fromUrl">Tải về</el-button></template>
      </el-input>
    </div>

    <div v-if="model.length" class="mt-3 flex flex-wrap gap-3">
      <div v-for="(m, i) in model" :key="m._id" class="media-tile">
        <img v-if="m.kind === 'image'" :src="fileUrl(m)" :alt="m.name" />
        <video v-else :src="fileUrl(m)" muted preload="metadata" />
        <span class="badge">{{ i + 1 }}{{ m.kind === 'video' ? ' · video' : '' }}</span>
        <div class="tools">
          <button type="button" :disabled="i === 0" title="Lên trước" @click="move(i, -1)">◀</button>
          <button type="button" :disabled="i === model.length - 1" title="Ra sau" @click="move(i, 1)">▶</button>
          <button type="button" title="Bỏ khỏi bài" @click="remove(i)">✕</button>
        </div>
        <div class="meta" :title="m.name">{{ describe(m) }}</div>
      </div>
    </div>
    <div v-else class="mt-2 text-xs text-slate-500">Chưa có media: bài sẽ là bài chữ.</div>

    <el-dialog v-model="library.open" title="Thư viện media" width="760px">
      <el-empty v-if="!library.items.length" description="Thư viện trống" :image-size="60" />
      <div class="flex max-h-[60vh] flex-wrap gap-3 overflow-auto">
        <button
          v-for="m in library.items"
          :key="m._id"
          type="button"
          class="media-tile pick"
          :class="{ picked: library.picked.includes(m._id) }"
          @click="togglePick(m._id)"
        >
          <img v-if="m.kind === 'image'" :src="fileUrl(m)" :alt="m.name" loading="lazy" />
          <video v-else :src="fileUrl(m)" muted preload="metadata" />
          <div class="meta">{{ describe(m) }}</div>
        </button>
      </div>
      <template #footer>
        <el-button @click="library.open = false">Huỷ</el-button>
        <el-button type="primary" :disabled="!library.picked.length" @click="addPicked">Thêm {{ library.picked.length || '' }} mục</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.media-tile {
  position: relative;
  width: 128px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  overflow: hidden;
  background: #f8fafc;
  padding: 0;
}
.media-tile img,
.media-tile video {
  display: block;
  width: 100%;
  height: 96px;
  object-fit: cover;
  background: #0f172a;
}
.media-tile .badge {
  position: absolute;
  top: 4px;
  left: 4px;
  font-size: 11px;
  background: rgb(15 23 42 / 0.75);
  color: #fff;
  border-radius: 4px;
  padding: 0 5px;
}
.media-tile .tools {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 2px;
}
.media-tile .tools button {
  font-size: 11px;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 0;
  background: rgb(255 255 255 / 0.9);
  cursor: pointer;
}
.media-tile .tools button:disabled {
  opacity: 0.35;
  cursor: default;
}
.media-tile .meta {
  font-size: 11px;
  color: #64748b;
  padding: 3px 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.media-tile.pick {
  cursor: pointer;
}
.media-tile.picked {
  outline: 3px solid var(--el-color-primary);
}
</style>
