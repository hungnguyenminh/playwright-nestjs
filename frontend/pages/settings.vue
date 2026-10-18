<script setup lang="ts">
interface AiSettings {
  enabled: boolean;
  baseUrl: string;
  authType: 'apiKey' | 'bearer';
  model: string;
  effort: '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  hasToken: boolean;
  tokenHint: string;
  tokenSource: 'settings' | 'env' | 'none';
  configured: boolean;
}

const { api } = useApi();
const saved = ref<AiSettings>();
const form = reactive({
  enabled: true,
  baseUrl: '',
  authType: 'apiKey' as AiSettings['authType'],
  model: '',
  effort: 'medium' as AiSettings['effort'],
  /** '' = keep the saved token. */
  token: '',
});
const changingToken = ref(false);
const saving = ref(false);
const testing = ref(false);
const testResult = ref<{ ok: boolean; latencyMs: number; model?: string; reply?: string; error?: string }>();
const models = ref<{ id: string; name: string }[]>([]);
const loadingModels = ref(false);

const SUGGESTED = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
const EFFORTS = [
  { value: 'low', label: 'low: nhanh, rẻ' },
  { value: 'medium', label: 'medium (khuyên dùng)' },
  { value: 'high', label: 'high: kỹ hơn' },
  { value: 'xhigh', label: 'xhigh' },
  { value: 'max', label: 'max: chậm, tốn nhất' },
  { value: '', label: 'Không gửi (gateway/model không hỗ trợ effort)' },
];

async function load() {
  saved.value = await tryApi(() => api<AiSettings>('/settings/ai'));
  if (!saved.value) return;
  Object.assign(form, {
    enabled: saved.value.enabled,
    baseUrl: saved.value.baseUrl,
    authType: saved.value.authType,
    model: saved.value.model,
    effort: saved.value.effort,
    token: '',
  });
  changingToken.value = !saved.value.hasToken;
}
load();

/** Only send the token when the user typed a new one. */
const body = () => ({
  enabled: form.enabled,
  baseUrl: form.baseUrl,
  authType: form.authType,
  model: form.model,
  effort: form.effort,
  ...(changingToken.value && form.token.trim() ? { token: form.token.trim() } : {}),
});

async function save() {
  saving.value = true;
  const res = await tryApi(() => api<AiSettings>('/settings/ai', { method: 'PUT', body: body() }), 'Đã lưu');
  saving.value = false;
  if (res) {
    saved.value = res;
    form.token = '';
    changingToken.value = !res.hasToken;
  }
}

async function removeToken() {
  const ok = await ElMessageBox.confirm('Xoá token đã lưu?', 'Xoá token', { type: 'warning' }).catch(() => false);
  if (!ok) return;
  const res = await tryApi(() => api<AiSettings>('/settings/ai', { method: 'PUT', body: { token: '' } }), 'Đã xoá token');
  if (res) {
    saved.value = res;
    changingToken.value = !res.hasToken;
  }
}

async function test() {
  testing.value = true;
  testResult.value = await tryApi(() => api<typeof testResult.value & {}>('/settings/ai/test', { method: 'POST', body: body() }));
  testing.value = false;
}

async function fetchModels() {
  loadingModels.value = true;
  const res = await tryApi(() =>
    api<{ ok: boolean; models: { id: string; name: string }[]; error?: string }>('/settings/ai/models', { method: 'POST', body: body() }),
  );
  loadingModels.value = false;
  if (!res) return;
  if (!res.ok) return void ElMessage.error(res.error ?? 'Không lấy được danh sách model');
  models.value = res.models;
  ElMessage.success(`Có ${res.models.length} model`);
}

const modelOptions = computed(() => {
  const ids = new Set([...models.value.map((m) => m.id), ...SUGGESTED]);
  return [...ids].map((id) => ({ value: id, label: models.value.find((m) => m.id === id)?.name ?? id }));
});
const querySearch = (q: string, cb: (items: { value: string; label: string }[]) => void) =>
  cb(modelOptions.value.filter((o) => !q || o.value.includes(q)));
</script>

<template>
  <div class="page !max-w-3xl">
    <PageHeader title="Cài đặt" subtitle="Kết nối trợ lý AI (Claude) dùng cho các nút “Tạo bằng AI” và “Nhờ AI sửa”." />

    <el-tabs model-value="ai" class="rounded-xl border border-slate-200/70 bg-white px-6 pb-6 pt-2 shadow-sm">
      <el-tab-pane label="AI" name="ai">
        <el-alert v-if="saved && !saved.configured" type="info" :closable="false" show-icon class="!mb-4">
          Nhập token và model để bật trợ lý "Tạo bằng AI" ở các trang Script, Profile và New job.
        </el-alert>

        <el-form label-position="top" @submit.prevent="save">
          <el-form-item label="Bật trợ lý AI">
            <el-switch v-model="form.enabled" />
          </el-form-item>

          <el-form-item label="Base URL">
            <el-input v-model="form.baseUrl" placeholder="Để trống = https://api.anthropic.com" clearable />
            <div class="text-xs text-gray-500">
              Đổi khi dùng gateway/proxy nội bộ. Endpoint phải tương thích <b>Anthropic Messages API</b> (<code>/v1/messages</code>).
            </div>
          </el-form-item>

          <el-form-item label="Loại token">
            <el-radio-group v-model="form.authType">
              <el-radio value="apiKey">API key (header <code>x-api-key</code>)</el-radio>
              <el-radio value="bearer">Bearer token (<code>Authorization: Bearer</code>)</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item label="Token">
            <div v-if="saved?.hasToken && !changingToken" class="flex w-full items-center gap-2">
              <el-input :model-value="`••••••••••••••••${saved.tokenHint}`" disabled class="!w-72" />
              <el-button @click="changingToken = true">Đổi token</el-button>
              <el-button v-if="saved.tokenSource === 'settings'" type="danger" plain @click="removeToken">Xoá</el-button>
              <span v-if="saved.tokenSource === 'env'" class="text-xs text-gray-500">(lấy từ backend/.env)</span>
            </div>
            <div v-else class="flex w-full items-center gap-2">
              <el-input v-model="form.token" type="password" show-password placeholder="sk-ant-… hoặc token của gateway" autocomplete="off" />
              <el-button v-if="saved?.hasToken" @click="(changingToken = false), (form.token = '')">Huỷ</el-button>
            </div>
            <div class="text-xs text-gray-500">
              Token được mã hoá (AES-256-GCM) trong MongoDB và không bao giờ gửi lại về trình duyệt; chỉ hiện 4 ký tự cuối.
            </div>
          </el-form-item>

          <el-form-item label="Model">
            <div class="flex w-full gap-2">
              <el-autocomplete v-model="form.model" :fetch-suggestions="querySearch" placeholder="claude-opus-5-5" class="!w-full" clearable>
                <template #default="{ item }">
                  <span class="font-mono text-sm">{{ item.value }}</span>
                  <span v-if="item.label !== item.value" class="ml-2 text-xs text-gray-400">{{ item.label }}</span>
                </template>
              </el-autocomplete>
              <el-button :loading="loadingModels" @click="fetchModels">Lấy danh sách</el-button>
            </div>
          </el-form-item>

          <el-form-item label="Effort (mức suy nghĩ)">
            <el-select v-model="form.effort" class="!w-96">
              <el-option v-for="e in EFFORTS" :key="e.value" :label="e.label" :value="e.value" />
            </el-select>
          </el-form-item>

          <div class="flex items-center gap-2">
            <el-button :loading="testing" @click="test">Kiểm tra kết nối</el-button>
            <el-button type="primary" native-type="submit" :loading="saving">Lưu</el-button>
          </div>
          <el-alert
            v-if="testResult"
            class="!mt-3"
            :type="testResult.ok ? 'success' : 'error'"
            :closable="false"
            show-icon
            :title="testResult.ok ? `Kết nối OK: ${testResult.model} trả lời “${testResult.reply}” sau ${(testResult.latencyMs / 1000).toFixed(1)}s` : testResult.error"
          />
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
