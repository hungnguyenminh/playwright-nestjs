<script setup lang="ts">
import type { Job, Script, Task } from '~/types/api';

const route = useRoute();
const isNew = computed(() => route.params.id === 'new');
const { api } = useApi();

const EXAMPLE = [
  { type: 'goto', url: '{{url}}' },
  { type: 'waitFor', selector: 'h1' },
  { type: 'extract', selector: 'h1', as: 'title' },
  {
    type: 'extract',
    selector: 'a',
    multiple: true,
    fields: { text: ':scope', href: { get: 'prop:href' } },
    as: 'links',
  },
  { type: 'screenshot', name: 'page' },
];

const EXAMPLE_TEXT = JSON.stringify(EXAMPLE, null, 2);
const form = reactive({
  name: '',
  description: '',
  actionsText: EXAMPLE_TEXT,
  varsText: '{\n  "url": "https://example.com"\n}',
  emulationText: '{}',
});
const schema = ref<object>();
const markers = ref(0);
const serverErrors = ref<string[]>([]);
const saving = ref(false);

// ---- AI assistant ------------------------------------------------------------
// ?aiFix=<taskId>: opened from a failed task to diagnose and fix its script.
const fixTaskId = computed(() => (route.query.aiFix as string) || undefined);
const fixTask = ref<Task>();
const fixJob = ref<Job>();
const aiApplied = ref(false);

/** What the assistant should edit; the untouched example of a new script counts as empty. */
function currentForm(): Record<string, unknown> {
  if (isNew.value && !form.name && form.actionsText === EXAMPLE_TEXT) return {};
  const tryParse = (t: string) => {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  };
  return {
    name: form.name,
    description: form.description,
    actions: tryParse(form.actionsText),
    defaultVars: tryParse(form.varsText),
    emulation: tryParse(form.emulationText),
  };
}

function applyAi(p: Record<string, any>) {
  Object.assign(form, {
    name: p.name || form.name,
    description: p.description ?? form.description,
    actionsText: JSON.stringify(p.actions ?? [], null, 2),
    varsText: JSON.stringify(p.defaultVars ?? {}, null, 2),
    emulationText: JSON.stringify(p.emulation ?? {}, null, 2),
  });
  serverErrors.value = [];
  aiApplied.value = true;
}

/** After fixing: save, re-run the failed tasks of the job with this script, open the job. */
async function saveAndRetry() {
  const saved = await save();
  if (!saved || !fixJob.value) return;
  const ok = await tryApi(() =>
    api(`/jobs/${fixJob.value!._id}/retry`, { method: 'POST', body: { useLatestScript: true } }).then(() => true),
  );
  if (ok) navigateTo(`/jobs/${fixJob.value._id}`);
}

onMounted(async () => {
  schema.value = await tryApi(() => api<object>('/actions/schema'));
  if (fixTaskId.value) {
    fixTask.value = await tryApi(() => api<Task>(`/tasks/${fixTaskId.value}`));
    if (fixTask.value) fixJob.value = await tryApi(() => api<Job>(`/jobs/${fixTask.value!.jobId}`));
  }
  if (isNew.value) {
    // "Dùng mẫu này" on the guide page hands over a template.
    const raw = sessionStorage.getItem('script-template');
    sessionStorage.removeItem('script-template');
    if (raw) {
      const t = JSON.parse(raw) as Partial<Script>;
      Object.assign(form, {
        name: t.name ?? '',
        description: t.description ?? '',
        actionsText: JSON.stringify(t.actions ?? [], null, 2),
        varsText: JSON.stringify(t.defaultVars ?? {}, null, 2),
        emulationText: JSON.stringify(t.emulation ?? {}, null, 2),
      });
    }
    return;
  }
  const s = await tryApi(() => api<Script>(`/scripts/${route.params.id}`));
  if (!s) return;
  Object.assign(form, {
    name: s.name,
    description: s.description,
    actionsText: JSON.stringify(s.actions ?? [], null, 2),
    varsText: JSON.stringify(s.defaultVars ?? {}, null, 2),
    emulationText: JSON.stringify(s.emulation ?? {}, null, 2),
  });
});

function body() {
  const parse = (text: string, what: string) => {
    try {
      return text.trim() ? JSON.parse(text) : undefined;
    } catch (err) {
      throw new Error(`${what}: ${(err as Error).message}`);
    }
  };
  return {
    name: form.name,
    description: form.description,
    actions: parse(form.actionsText, 'Actions'),
    defaultVars: parse(form.varsText, 'Default variables') ?? {},
    emulation: parse(form.emulationText, 'Emulation') ?? {},
  };
}

async function save(): Promise<Script | undefined> {
  serverErrors.value = [];
  let payload;
  try {
    payload = body();
  } catch (err) {
    ElMessage.error((err as Error).message);
    return;
  }
  if (!payload.name) return void ElMessage.error('Name is required');
  saving.value = true;
  try {
    const saved = isNew.value
      ? await api<Script>('/scripts', { method: 'POST', body: payload })
      : await api<Script>(`/scripts/${route.params.id}`, { method: 'PUT', body: payload });
    ElMessage.success('Saved');
    if (isNew.value) await navigateTo({ path: `/scripts/${saved._id}`, query: route.query }, { replace: true });
    return saved;
  } catch (err: any) {
    serverErrors.value = err?.data?.errors ?? [];
    ElMessage.error(apiErrorText(err));
  } finally {
    saving.value = false;
  }
}

/** Save, then run once with the default variables and open the live view. */
async function testRun() {
  const saved = await save();
  if (!saved) return;
  const job = await tryApi(() =>
    api<Job>('/jobs', { method: 'POST', body: { scriptId: saved._id, name: `${saved.name} (test)`, headless: false } }),
  );
  if (job) navigateTo(`/jobs/${job._id}`);
}
</script>

<template>
  <div class="page">
    <PageHeader :title="isNew ? 'Script mới' : form.name || 'Script'" subtitle="Danh sách bước (DSL JSON). Ctrl+Space trong trình soạn để xem gợi ý." back="/scripts">
      <template #actions>
        <el-button @click="testRun">Lưu &amp; chạy thử (headed)</el-button>
        <el-button v-if="!isNew" @click="navigateTo(`/jobs/new?scriptId=${route.params.id}`)">Tạo job…</el-button>
        <el-button type="primary" :loading="saving" @click="save">Lưu</el-button>
      </template>
    </PageHeader>

    <el-alert v-if="fixTask" type="error" :closable="false" show-icon>
      <template #title>
        Đang sửa script cho task lỗi
        <NuxtLink :to="`/tasks/${fixTask._id}`">{{ fixTask.name }}</NuxtLink>
        ({{ fixJob?.name }}): bước {{ fixTask.error?.stepPath }}, {{ fixTask.error?.message }}
      </template>
      <div v-if="aiApplied" class="mt-2 flex flex-wrap items-center gap-2">
        <template v-if="fixJob?.scriptId">
          <el-button type="danger" size="small" :loading="saving" @click="saveAndRetry">
            Lưu &amp; chạy lại task lỗi với script này
          </el-button>
          <span class="text-xs">Các task lỗi của job sẽ chạy lại bằng script vừa sửa.</span>
        </template>
        <span v-else class="text-xs">Job này chạy inline actions: lưu script rồi tạo job mới từ script.</span>
      </div>
    </el-alert>

    <AiAssistPanel
      v-if="!fixTaskId || fixTask"
      kind="script"
      :current-form="currentForm"
      allow-snapshot
      :fix-task-id="fixTaskId"
      :auto-prompt="fixTaskId ? 'Task này bị lỗi. Hãy tìm nguyên nhân và sửa script.' : undefined"
      :default-url="fixTask?.currentUrl"
      :default-profile-id="fixJob?.profileId"
      :start-open="isNew && !route.query.template"
      placeholder="Ví dụ: Mở trang https://… , tìm từ khoá {{keyword}}, lấy tên, giá, link của 20 sản phẩm đầu tiên"
      @accept="applyAi"
    />

    <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <el-card shadow="never" class="xl:col-span-2">
        <template #header>
          <div class="flex items-center justify-between">
            <span>Các bước (actions)</span>
            <span class="text-xs" :class="markers ? 'text-red-600' : 'text-gray-400'">
              {{ markers ? `${markers} lỗi` : 'Ctrl+Space để xem gợi ý' }}
            </span>
          </div>
        </template>
        <JsonEditor v-if="schema" v-model="form.actionsText" :schema="schema" height="560px" @markers="markers = $event" />
        <el-alert v-if="serverErrors.length" type="error" :closable="false" class="mt-3" title="Lỗi kiểm tra">
          <div v-for="e in serverErrors" :key="e" class="font-mono text-xs">{{ e }}</div>
        </el-alert>
      </el-card>

      <div class="space-y-4">
        <el-card shadow="never" header="Thông tin">
          <el-form label-position="top">
            <el-form-item label="Tên"><el-input v-model="form.name" /></el-form-item>
            <el-form-item label="Mô tả">
              <el-input v-model="form.description" type="textarea" :rows="2" />
            </el-form-item>
          </el-form>
        </el-card>
        <el-card shadow="never" header="Biến mặc định">
          <JsonEditor v-model="form.varsText" height="140px" />
          <div class="mt-2 text-xs text-gray-500">
            Dùng dạng <code v-pre>{{tên}}</code> trong mọi chuỗi. Inputs của job sẽ ghi đè các giá trị này.
          </div>
        </el-card>
        <el-card shadow="never" header="Emulation">
          <JsonEditor v-model="form.emulationText" height="140px" />
          <div class="mt-2 text-xs text-gray-500">
            viewport, userAgent, locale, timezoneId, geolocation, proxy, extraHTTPHeaders…
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>
