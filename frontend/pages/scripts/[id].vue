<script setup lang="ts">
import type { Job, Script } from '~/types/api';

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

const form = reactive({
  name: '',
  description: '',
  actionsText: JSON.stringify(EXAMPLE, null, 2),
  varsText: '{\n  "url": "https://example.com"\n}',
  emulationText: '{}',
});
const schema = ref<object>();
const markers = ref(0);
const serverErrors = ref<string[]>([]);
const saving = ref(false);

onMounted(async () => {
  schema.value = await tryApi(() => api<object>('/actions/schema'));
  if (isNew.value) return;
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
    if (isNew.value) await navigateTo(`/scripts/${saved._id}`, { replace: true });
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
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <el-button text @click="navigateTo('/scripts')">←</el-button>
        <h1 class="m-0 text-xl font-semibold">{{ isNew ? 'New script' : form.name }}</h1>
      </div>
      <div class="flex gap-2">
        <el-button @click="testRun">Save &amp; test run (headed)</el-button>
        <el-button v-if="!isNew" @click="navigateTo(`/jobs/new?scriptId=${route.params.id}`)">New job…</el-button>
        <el-button type="primary" :loading="saving" @click="save">Save</el-button>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <el-card shadow="never" class="xl:col-span-2">
        <template #header>
          <div class="flex items-center justify-between">
            <span>Actions</span>
            <span class="text-xs" :class="markers ? 'text-red-600' : 'text-gray-400'">
              {{ markers ? `${markers} problem(s)` : 'Ctrl+Space for suggestions' }}
            </span>
          </div>
        </template>
        <JsonEditor v-if="schema" v-model="form.actionsText" :schema="schema" height="560px" @markers="markers = $event" />
        <el-alert v-if="serverErrors.length" type="error" :closable="false" class="mt-3" title="Validation errors">
          <div v-for="e in serverErrors" :key="e" class="font-mono text-xs">{{ e }}</div>
        </el-alert>
      </el-card>

      <div class="space-y-4">
        <el-card shadow="never" header="Details">
          <el-form label-position="top">
            <el-form-item label="Name"><el-input v-model="form.name" /></el-form-item>
            <el-form-item label="Description">
              <el-input v-model="form.description" type="textarea" :rows="2" />
            </el-form-item>
          </el-form>
        </el-card>
        <el-card shadow="never" header="Default variables">
          <JsonEditor v-model="form.varsText" height="140px" />
          <div class="mt-2 text-xs text-gray-500">
            Use as <code v-pre>{{name}}</code> in any string. Job inputs override these.
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
