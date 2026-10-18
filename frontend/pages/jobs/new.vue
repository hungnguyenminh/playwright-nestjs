<script setup lang="ts">
import type { Job, Profile, Script } from '~/types/api';

const route = useRoute();
const { api } = useApi();

const scripts = ref<Script[]>([]);
const profiles = ref<Profile[]>([]);
const schema = ref<object>();

const form = reactive({
  source: 'script' as 'script' | 'inline',
  scriptId: (route.query.scriptId as string) || '',
  actionsText: '[\n  { "type": "goto", "url": "{{url}}" },\n  { "type": "extract", "selector": "h1", "as": "title" }\n]',
  name: '',
  inputsText: '',
  varsText: '',
  concurrency: 3,
  headless: true,
  profileId: '',
  maxRetries: 0,
  stepTimeout: 30,
});
const submitting = ref(false);

onMounted(async () => {
  const [s, p, sc] = await Promise.all([
    tryApi(() => api<Script[]>('/scripts')),
    tryApi(() => api<Profile[]>('/profiles')),
    tryApi(() => api<object>('/actions/schema')),
  ]);
  scripts.value = s ?? [];
  profiles.value = p ?? [];
  schema.value = sc;
  if (!form.scriptId && !scripts.value.length) form.source = 'inline';
});

const selectedScript = computed(() => scripts.value.find((s) => s._id === form.scriptId));

const parsed = computed(() => {
  try {
    return { inputs: parseInputs(form.inputsText), error: '' };
  } catch (err) {
    return { inputs: [], error: (err as Error).message };
  }
});
const columns = computed(() => [...new Set(parsed.value.inputs.slice(0, 50).flatMap((r) => Object.keys(r)))]);
const taskCount = computed(() => parsed.value.inputs.length || 1);

function parseJson(text: string, what: string) {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${what}: ${(err as Error).message}`);
  }
}

async function submit() {
  let body: Record<string, unknown>;
  try {
    if (parsed.value.error) throw new Error(`Inputs: ${parsed.value.error}`);
    body = {
      name: form.name || undefined,
      scriptId: form.source === 'script' ? form.scriptId || undefined : undefined,
      actions: form.source === 'inline' ? parseJson(form.actionsText, 'Actions') : undefined,
      inputs: parsed.value.inputs.length ? parsed.value.inputs : undefined,
      vars: parseJson(form.varsText, 'Shared variables'),
      concurrency: form.concurrency,
      headless: form.headless,
      profileId: form.profileId || undefined,
      maxRetries: form.maxRetries,
      stepTimeout: form.stepTimeout * 1000,
    };
  } catch (err) {
    ElMessage.error((err as Error).message);
    return;
  }
  if (form.source === 'script' && !body.scriptId) return ElMessage.error('Choose a script');
  submitting.value = true;
  const job = await tryApi(() => api<Job>('/jobs', { method: 'POST', body }));
  submitting.value = false;
  if (job) navigateTo(`/jobs/${job._id}`);
}
</script>

<template>
  <div class="max-w-5xl space-y-4">
    <h1 class="m-0 text-xl font-semibold">New job</h1>

    <el-form label-position="top" @submit.prevent="submit">
      <el-card shadow="never" header="What to run" class="mb-4">
        <el-radio-group v-model="form.source" class="mb-4">
          <el-radio-button value="script">Saved script</el-radio-button>
          <el-radio-button value="inline">Inline actions</el-radio-button>
        </el-radio-group>

        <template v-if="form.source === 'script'">
          <el-form-item label="Script">
            <el-select v-model="form.scriptId" filterable placeholder="Choose a script" class="!w-full">
              <el-option v-for="s in scripts" :key="s._id" :label="s.name" :value="s._id">
                <span>{{ s.name }}</span>
                <span class="ml-2 text-xs text-gray-400">{{ s.description }}</span>
              </el-option>
            </el-select>
          </el-form-item>
          <div v-if="selectedScript && Object.keys(selectedScript.defaultVars ?? {}).length" class="text-xs text-gray-500">
            Default variables: <code>{{ JSON.stringify(selectedScript.defaultVars) }}</code>
          </div>
        </template>
        <JsonEditor v-else-if="schema" v-model="form.actionsText" :schema="schema" height="260px" />
      </el-card>

      <el-card shadow="never" class="mb-4">
        <template #header>
          <div class="flex items-center justify-between">
            <span>Inputs — one task per row</span>
            <span class="text-sm text-gray-500">{{ taskCount }} task(s)</span>
          </div>
        </template>
        <el-input
          v-model="form.inputsText"
          type="textarea"
          :rows="6"
          class="font-mono"
          placeholder='CSV with a header row, e.g.
name,url
Example,https://example.com
Wikipedia,https://wikipedia.org

or JSON: [{ "name": "Example", "url": "https://example.com" }]
Empty = a single task with no inputs.'
        />
        <div v-if="parsed.error" class="mt-2 text-sm text-red-600">{{ parsed.error }}</div>
        <el-table v-else-if="parsed.inputs.length" :data="parsed.inputs.slice(0, 20)" size="small" class="mt-3" max-height="260">
          <el-table-column type="index" width="50" />
          <el-table-column v-for="c in columns" :key="c" :label="c" :prop="c" show-overflow-tooltip />
        </el-table>
        <div v-if="parsed.inputs.length > 20" class="mt-1 text-xs text-gray-400">
          Showing 20 of {{ parsed.inputs.length }} rows
        </div>

        <el-form-item label="Shared variables (JSON, optional)" class="!mb-0 mt-4">
          <el-input v-model="form.varsText" type="textarea" :rows="2" class="font-mono" placeholder='{ "keyword": "laptop" }' />
        </el-form-item>
      </el-card>

      <el-card shadow="never" header="Execution" class="mb-4">
        <div class="grid grid-cols-1 gap-x-6 md:grid-cols-3">
          <el-form-item label="Job name">
            <el-input v-model="form.name" :placeholder="selectedScript?.name ?? 'Ad-hoc job'" />
          </el-form-item>
          <el-form-item label="Concurrency (parallel Chrome contexts)">
            <el-input-number v-model="form.concurrency" :min="1" :max="50" :disabled="!!form.profileId" />
          </el-form-item>
          <el-form-item label="Show Chrome windows">
            <el-switch v-model="form.headless" :active-value="false" :inactive-value="true" active-text="headed" inactive-text="headless" />
          </el-form-item>
          <el-form-item label="Profile (keeps logins; runs tasks one by one)">
            <el-select v-model="form.profileId" clearable placeholder="None — fresh context per task" class="!w-full">
              <el-option v-for="p in profiles" :key="p._id" :label="p.name" :value="p._id" :disabled="p.inUse" />
            </el-select>
          </el-form-item>
          <el-form-item label="Retries per failed task">
            <el-input-number v-model="form.maxRetries" :min="0" :max="5" />
          </el-form-item>
          <el-form-item label="Step timeout (s)">
            <el-input-number v-model="form.stepTimeout" :min="1" :max="600" />
          </el-form-item>
        </div>
      </el-card>

      <el-button type="primary" size="large" native-type="submit" :loading="submitting">
        Start {{ taskCount }} task(s)
      </el-button>
    </el-form>
  </div>
</template>
