<script setup lang="ts">
import { MagicStick } from '@element-plus/icons-vue';
import type { Profile } from '~/types/api';
import type { AiKind, AiProposal, AiTurn } from '~/composables/useAi';

/**
 * "Tạo bằng AI": the user describes what they want, the assistant streams a
 * guide and proposes values for the page's form. Accept only fills the form;
 * saving / starting stays with the user.
 */
const props = withDefaults(
  defineProps<{
    kind: AiKind;
    /** Current form values, so the AI edits instead of starting over. */
    currentForm?: () => Record<string, unknown>;
    /** Show the "read the page first" option. */
    allowSnapshot?: boolean;
    defaultUrl?: string;
    defaultProfileId?: string;
    /** Fix mode: diagnose this failed task. */
    fixTaskId?: string;
    /** Sent automatically once on mount (fix mode). */
    autoPrompt?: string;
    placeholder?: string;
    startOpen?: boolean;
  }>(),
  { allowSnapshot: false, startOpen: false, placeholder: 'Mô tả bạn muốn làm gì…' },
);
const emit = defineEmits<{ accept: [payload: Record<string, any>] }>();

const { api } = useApi();
const ai = useAi();

const open = ref(props.startOpen || !!props.autoPrompt);
const configured = ref<boolean | null>(null);
const model = ref('');
const prompt = ref('');
const useSnapshot = ref(!!props.defaultUrl || !!props.fixTaskId);
const snapshotUrl = ref(props.defaultUrl ?? '');
const snapshotProfileId = ref(props.defaultProfileId ?? '');
const profiles = ref<Profile[]>([]);

interface Turn extends AiTurn {
  statusText: string;
  snapshot?: { url: string; title: string; screenshot: string };
  result?: AiProposal;
  error?: string;
  accepted?: boolean;
  usage?: Record<string, number>;
}
const turns = ref<Turn[]>([]);
const current = computed(() => turns.value.at(-1));
const busy = ref(false);
let controller: AbortController | undefined;

onMounted(async () => {
  const s = await ai.status().catch(() => undefined);
  configured.value = s?.configured ?? false;
  model.value = s?.model ?? '';
  if (props.allowSnapshot) profiles.value = (await api<Profile[]>('/profiles').catch(() => [])) ?? [];
  if (props.autoPrompt && configured.value) {
    prompt.value = props.autoPrompt;
    if (!/^https?:\/\//.test(snapshotUrl.value)) useSnapshot.value = false;
    void send();
  }
});

watch(
  () => [props.defaultUrl, props.defaultProfileId] as const,
  ([url, profileId]) => {
    if (url && !snapshotUrl.value) snapshotUrl.value = url;
    if (profileId && !snapshotProfileId.value) snapshotProfileId.value = profileId;
    if (url) useSnapshot.value = true;
  },
);

// A URL typed in the request is the obvious page to read.
watch(prompt, (text) => {
  const url = /https?:\/\/[^\s"'<>]+/.exec(text)?.[0];
  if (url && props.allowSnapshot && !snapshotUrl.value) snapshotUrl.value = url;
});

async function send() {
  const text = prompt.value.trim();
  if (!text || busy.value) return;
  if (useSnapshot.value && props.allowSnapshot && !/^https?:\/\//.test(snapshotUrl.value)) {
    return ElMessage.warning('Nhập URL trang cần đọc (http:// hoặc https://), hoặc bỏ chọn "Đọc trang".');
  }
  const history: AiTurn[] = turns.value
    .filter((t) => t.result)
    .map((t) => ({ prompt: t.prompt, guide: t.guide, proposal: t.result!.payload }));
  const turn = reactive<Turn>({ prompt: text, guide: '', statusText: 'Đang gửi…' }) as Turn;
  turns.value.push(turn);
  prompt.value = '';
  busy.value = true;
  controller = new AbortController();
  try {
    await ai.assist(
      {
        kind: props.kind,
        prompt: text,
        history,
        currentForm: props.currentForm?.(),
        ...(props.allowSnapshot && useSnapshot.value
          ? { snapshotUrl: snapshotUrl.value, snapshotProfileId: snapshotProfileId.value || undefined }
          : {}),
        // Only the first request of a fix conversation carries the task.
        ...(props.fixTaskId && turns.value.length === 1 ? { fixTaskId: props.fixTaskId } : {}),
      },
      {
        status: (d) => (turn.statusText = d.message),
        snapshot: (d) => (turn.snapshot = d),
        text: (d) => (turn.guide += d.delta),
        proposal: (d) => (turn.result = d),
        error: (d) => (turn.error = d.message),
        done: (d) => (turn.usage = d.usage),
      },
      controller.signal,
    );
  } catch (err) {
    if ((err as Error).name !== 'AbortError') turn.error = (err as Error).message;
    else turn.error = 'Đã dừng.';
  } finally {
    busy.value = false;
    turn.statusText = '';
    // Pages read once; follow-ups usually refine the same proposal.
    if (turn.result) useSnapshot.value = false;
  }
}

function stop() {
  controller?.abort();
}

function accept(turn: Turn) {
  if (!turn.result) return;
  emit('accept', turn.result.payload);
  turn.accepted = true;
  ElMessage.success('Đã điền vào form. Kiểm tra lại rồi bấm lưu / chạy.');
}

function reset() {
  turns.value = [];
}

/** Short summary lines of a proposal for the preview. */
function summary(p: AiProposal): string[] {
  const x = p.payload;
  if (p.kind === 'script') {
    const types = (x.actions as Array<{ type: string }>).map((a) => a.type);
    return [
      `Tên: ${x.name || '—'}`,
      `${types.length} bước: ${types.join(' → ') || '—'}`,
      `Biến mặc định: ${Object.keys(x.defaultVars ?? {}).join(', ') || '(không)'}`,
      ...(Object.keys(x.emulation ?? {}).length ? [`Emulation: ${JSON.stringify(x.emulation)}`] : []),
    ];
  }
  if (p.kind === 'profile') {
    return [
      `Tên: ${x.name || '—'}`,
      ...(x.notes ? [`Ghi chú: ${x.notes}`] : []),
      `Proxy: ${x.proxy?.server ?? '(không)'}`,
      `Emulation: ${JSON.stringify(x.emulation ?? {})}`,
    ];
  }
  const profile = profiles.value.find((pr) => pr._id === x.profileId);
  return [
    x.source === 'script' ? `Script: ${x.scriptId}` : `Inline actions: ${(x.actions ?? []).length} bước`,
    `${x.taskCount} task · concurrency ${x.concurrency} · ${x.headless ? 'headless' : 'headed'}`,
    `Profile: ${x.profileId ? (profile?.name ?? x.profileId) : '(không)'}`,
    `Retries ${x.maxRetries} · timeout ${x.stepTimeout}s`,
  ];
}

const tokens = (u?: Record<string, number>) =>
  u ? `${u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens} vào (${u.cache_read_input_tokens} từ cache) · ${u.output_tokens} ra` : '';
</script>

<template>
  <el-card shadow="never" class="ai-panel" body-class="!p-0">
    <template #header>
      <div class="flex cursor-pointer items-center justify-between" @click="open = !open">
        <span class="flex items-center gap-2 font-semibold text-violet-700">
          <el-icon><MagicStick /></el-icon> Tạo bằng AI
          <span v-if="model && configured" class="text-xs font-normal text-gray-400">{{ model }}</span>
        </span>
        <el-button link size="small">{{ open ? 'Thu gọn' : 'Mở' }}</el-button>
      </div>
    </template>

    <div v-show="open" class="space-y-3 p-4">
      <el-alert v-if="configured === false" type="info" :closable="false" show-icon>
        Trợ lý AI chưa được cấu hình.
        <NuxtLink to="/settings">Vào Cài đặt → AI</NuxtLink> để nhập token và model.
      </el-alert>

      <template v-else>
        <!-- conversation -->
        <div v-for="(t, i) in turns" :key="i" class="space-y-2 rounded border border-gray-200 p-3">
          <div class="text-sm"><span class="font-medium text-gray-500">Bạn:</span> {{ t.prompt }}</div>

          <div v-if="t.snapshot" class="flex items-center gap-3 rounded bg-gray-50 p-2 text-xs text-gray-500">
            <img :src="`data:image/jpeg;base64,${t.snapshot.screenshot}`" class="h-14 rounded border" alt="page" />
            <span>AI đã đọc trang <b>{{ t.snapshot.title }}</b><br />{{ t.snapshot.url }}</span>
          </div>

          <div v-if="t.statusText" class="flex items-center gap-2 text-xs text-violet-600">
            <span class="h-2 w-2 animate-pulse rounded-full bg-violet-500" /> {{ t.statusText }}
          </div>

          <AiMarkdown v-if="t.guide" :source="t.guide" class="text-sm" />

          <el-alert v-if="t.error" type="error" :closable="false" :title="t.error" show-icon />

          <div v-if="t.result" class="rounded border border-violet-200 bg-violet-50/50 p-3">
            <div class="mb-2 flex items-center justify-between">
              <span class="text-sm font-medium">Sẽ điền vào form</span>
              <el-tag v-if="!t.result.errors.length" type="success" size="small">Hợp lệ</el-tag>
              <el-tag v-else type="danger" size="small">{{ t.result.errors.length }} lỗi</el-tag>
            </div>
            <ul class="m-0 space-y-0.5 pl-4 text-xs text-gray-700">
              <li v-for="line in summary(t.result)" :key="line" class="break-all">{{ line }}</li>
            </ul>
            <div v-for="e in t.result.errors" :key="e" class="mt-1 font-mono text-xs text-red-600">✗ {{ e }}</div>
            <div v-for="w in t.result.warnings" :key="w" class="mt-1 text-xs text-amber-600">⚠ {{ w }}</div>
            <el-collapse class="mt-2">
              <el-collapse-item title="Xem chi tiết (JSON)">
                <pre class="m-0 max-h-72 overflow-auto rounded bg-gray-950 p-2 text-xs text-gray-100">{{ JSON.stringify(t.result.payload, null, 2) }}</pre>
              </el-collapse-item>
            </el-collapse>
            <div v-if="i === turns.length - 1" class="mt-3 flex flex-wrap items-center gap-2">
              <el-button type="primary" size="small" :disabled="t.accepted" @click="accept(t)">
                {{ t.accepted ? 'Đã điền vào form' : 'Accept: điền vào form' }}
              </el-button>
              <span class="text-xs text-gray-500">hoặc gõ yêu cầu chỉnh bên dưới</span>
              <el-button link size="small" class="!ml-auto" @click="reset">Bắt đầu lại</el-button>
            </div>
            <div v-if="t.usage" class="mt-2 text-[11px] text-gray-400">{{ tokens(t.usage) }}</div>
          </div>
        </div>

        <!-- input -->
        <el-input
          v-model="prompt"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 8 }"
          :placeholder="turns.length ? 'Yêu cầu chỉnh, ví dụ: cuộn 30 lần, thêm chụp ảnh…' : props.placeholder"
          :disabled="busy"
          @keydown.ctrl.enter="send"
        />
        <div v-if="props.allowSnapshot" class="flex flex-wrap items-center gap-2 text-sm">
          <el-checkbox v-model="useSnapshot">Đọc trang trước khi viết (selector chính xác hơn)</el-checkbox>
          <template v-if="useSnapshot">
            <el-input v-model="snapshotUrl" placeholder="https://… trang cần đọc" size="small" class="!w-80" />
            <el-select v-model="snapshotProfileId" clearable placeholder="Không dùng profile" size="small" class="!w-52">
              <el-option v-for="p in profiles" :key="p._id" :label="`Profile: ${p.name}`" :value="p._id" :disabled="p.inUse" />
            </el-select>
          </template>
        </div>
        <div class="flex items-center gap-2">
          <el-button v-if="!busy" type="primary" color="#7c3aed" :disabled="!prompt.trim()" @click="send">
            {{ turns.length ? 'Gửi yêu cầu chỉnh' : 'Tạo hướng dẫn' }}
          </el-button>
          <el-button v-else type="warning" plain @click="stop">Dừng</el-button>
          <span class="text-xs text-gray-400">Ctrl+Enter để gửi · Accept chỉ điền form, không tự lưu hay chạy</span>
        </div>
      </template>
    </div>
  </el-card>
</template>

<style scoped>
.ai-panel :deep(.el-card__header) {
  background: linear-gradient(90deg, #f5f3ff, #ffffff);
  padding: 10px 16px;
}
</style>
