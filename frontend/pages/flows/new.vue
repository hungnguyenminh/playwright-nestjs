<script setup lang="ts">
import type { Flow, Job, Paged, Profile, Script, Task, TaskPatch } from '~/types/api';

/**
 * Wizard for a new "Luồng": goal → profile (if the site needs a login) →
 * script → job & tasks → confirm. `?id=` edits an existing flow.
 */
const route = useRoute();
const editId = computed(() => (route.query.id as string) || '');
const { api } = useApi();

const step = ref(0);
const STEPS = ['Mục tiêu', 'Profile', 'Script', 'Job & task', 'Xác nhận'];

const scripts = ref<Script[]>([]);
const profiles = ref<Profile[]>([]);
const schema = ref<object>();

const goal = reactive({ name: '', description: '', needsLogin: false });

// ---- profile -------------------------------------------------------------
const profileMode = ref<'existing' | 'new' | 'none'>('none');
const profileId = ref('');
const newProfile = reactive({ name: '', notes: '', proxyServer: '', proxyUser: '', proxyPass: '', emulationText: '{\n  "locale": "vi-VN",\n  "timezoneId": "Asia/Ho_Chi_Minh"\n}' });
const creatingProfile = ref(false);
const selectedProfile = computed(() => profiles.value.find((p) => p._id === profileId.value));

watch(
  () => goal.needsLogin,
  (needs) => {
    if (needs && profileMode.value === 'none') profileMode.value = profiles.value.length ? 'existing' : 'new';
    if (!needs && !profileId.value) profileMode.value = 'none';
  },
);

async function createProfile() {
  let emulation;
  try {
    emulation = JSON.parse(newProfile.emulationText || '{}');
  } catch (err) {
    return ElMessage.error(`Emulation: ${(err as Error).message}`);
  }
  if (!newProfile.name.trim()) return ElMessage.error('Nhập tên profile');
  creatingProfile.value = true;
  const p = await tryApi(
    () =>
      api<Profile>('/profiles', {
        method: 'POST',
        body: {
          name: newProfile.name.trim(),
          notes: newProfile.notes,
          emulation,
          proxy: newProfile.proxyServer
            ? { server: newProfile.proxyServer, username: newProfile.proxyUser || undefined, password: newProfile.proxyPass || undefined }
            : null,
        },
      }),
    'Đã tạo profile',
  );
  creatingProfile.value = false;
  if (!p) return;
  profiles.value = [...profiles.value, p];
  profileId.value = p._id;
  profileMode.value = 'existing';
}

function applyProfileAi(p: Record<string, any>) {
  Object.assign(newProfile, {
    name: p.name || newProfile.name,
    notes: p.notes ?? '',
    proxyServer: p.proxy?.server ?? '',
    proxyUser: p.proxy?.username ?? '',
    proxyPass: p.proxy?.password || newProfile.proxyPass,
    emulationText: JSON.stringify(p.emulation ?? {}, null, 2),
  });
}

// ---- script --------------------------------------------------------------
const scriptMode = ref<'existing' | 'new'>('new');
const scriptId = ref('');
const draft = reactive({
  name: '',
  description: '',
  actionsText: '[\n  { "type": "goto", "url": "{{url}}" }\n]',
  varsText: '{\n  "url": "https://"\n}',
});
const savingScript = ref(false);
const selectedScript = computed(() => scripts.value.find((s) => s._id === scriptId.value));

function parseJson(text: string, what: string) {
  try {
    return text.trim() ? JSON.parse(text) : undefined;
  } catch (err) {
    throw new Error(`${what}: ${(err as Error).message}`);
  }
}

function currentScriptForm(): Record<string, unknown> {
  if (scriptMode.value === 'existing' && selectedScript.value) {
    return { name: selectedScript.value.name, actions: selectedScript.value.actions, defaultVars: selectedScript.value.defaultVars };
  }
  const tryParse = (t: string) => {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  };
  return { name: draft.name, description: draft.description, actions: tryParse(draft.actionsText), defaultVars: tryParse(draft.varsText) };
}

function applyScriptAi(p: Record<string, any>) {
  scriptMode.value = 'new';
  scriptId.value = '';
  Object.assign(draft, {
    name: p.name || draft.name || goal.name,
    description: p.description ?? draft.description,
    actionsText: JSON.stringify(p.actions ?? [], null, 2),
    varsText: JSON.stringify(p.defaultVars ?? {}, null, 2),
  });
}

/** Saves the draft as a script (create, or update if it was already saved in this wizard). */
async function saveScript(): Promise<boolean> {
  let body;
  try {
    body = {
      name: draft.name.trim() || goal.name,
      description: draft.description,
      actions: parseJson(draft.actionsText, 'Actions'),
      defaultVars: parseJson(draft.varsText, 'Biến mặc định') ?? {},
    };
  } catch (err) {
    ElMessage.error((err as Error).message);
    return false;
  }
  savingScript.value = true;
  const saved = await tryApi(
    () =>
      draftScriptId.value
        ? api<Script>(`/scripts/${draftScriptId.value}`, { method: 'PUT', body })
        : api<Script>('/scripts', { method: 'POST', body }),
    'Đã lưu script',
  );
  savingScript.value = false;
  if (!saved) return false;
  draftScriptId.value = saved._id;
  scripts.value = [saved, ...scripts.value.filter((s) => s._id !== saved._id)];
  return true;
}
const draftScriptId = ref('');

/** One headed test run of the script (with the chosen profile), shown inline. */
const testTask = ref<Task>();
const testing = ref(false);
async function testRun() {
  if (scriptMode.value === 'new' && !(await saveScript())) return;
  const id = scriptMode.value === 'new' ? draftScriptId.value : scriptId.value;
  if (!id) return ElMessage.warning('Chọn script');
  testing.value = true;
  const job = await tryApi(() =>
    api<Job>('/jobs', {
      method: 'POST',
      body: { scriptId: id, name: `${goal.name || 'Luồng mới'} (chạy thử)`, headless: false, profileId: profileId.value || undefined },
    }),
  );
  testing.value = false;
  if (job) testTask.value = (await api<Paged<Task>>(`/jobs/${job._id}/tasks`)).items[0];
}
useLiveRoom('subscribe:job', () => (testTask.value ? { jobId: testTask.value.jobId } : null));
useLiveEvent<TaskPatch>('task:update', (p) => {
  if (testTask.value && p._id === testTask.value._id) Object.assign(testTask.value, p);
});

// ---- job & tasks --------------------------------------------------------------
const run = reactive({ inputsText: '', varsText: '', concurrency: 3, headless: true, maxRetries: 0, stepTimeout: 30 });

const activeActions = computed(() => {
  if (scriptMode.value === 'existing') return selectedScript.value?.actions ?? [];
  try {
    return JSON.parse(draft.actionsText);
  } catch {
    return [];
  }
});
const activeDefaults = computed<Record<string, unknown>>(() => {
  if (scriptMode.value === 'existing') return selectedScript.value?.defaultVars ?? {};
  try {
    return JSON.parse(draft.varsText) ?? {};
  } catch {
    return {};
  }
});
/** `{{name}}` variables the script uses (not runtime ones like $index). */
const scriptVars = computed(() => {
  const names = new Set<string>();
  JSON.stringify(activeActions.value).replace(/\{\{\s*([A-Za-z_][\w]*)/g, (_, n: string) => (names.add(n), ''));
  return [...names];
});
const parsedInputs = computed(() => {
  try {
    return { rows: parseInputs(run.inputsText), error: '' };
  } catch (err) {
    return { rows: [], error: (err as Error).message };
  }
});
const inputColumns = computed(() => [...new Set(parsedInputs.value.rows.slice(0, 50).flatMap((r) => Object.keys(r)))]);
const taskCount = computed(() => parsedInputs.value.rows.length || 1);

function fillInputsTemplate() {
  const cols = ['name', ...scriptVars.value.filter((v) => v !== 'name')];
  const sample = cols.map((c) => (c === 'name' ? 'Task 1' : String(activeDefaults.value[c] ?? '')));
  run.inputsText = `${cols.join(',')}\n${sample.join(',')}`;
}

function currentJobForm(): Record<string, unknown> {
  return { scriptId: scriptMode.value === 'new' ? draftScriptId.value : scriptId.value, profileId: profileId.value, inputs: run.inputsText, vars: run.varsText, concurrency: run.concurrency, headless: run.headless };
}
function applyJobAi(p: Record<string, any>) {
  Object.assign(run, {
    inputsText: p.inputsText ?? run.inputsText,
    varsText: p.varsText ?? run.varsText,
    concurrency: p.concurrency ?? run.concurrency,
    headless: p.headless ?? run.headless,
    maxRetries: p.maxRetries ?? run.maxRetries,
    stepTimeout: p.stepTimeout ?? run.stepTimeout,
  });
}

// ---- navigation ----------------------------------------------------------------
async function next() {
  if (step.value === 0) {
    if (!goal.name.trim()) return ElMessage.error('Đặt tên cho luồng');
    if (!draft.name) draft.name = goal.name;
  }
  if (step.value === 1 && profileMode.value !== 'none' && !profileId.value) {
    return ElMessage.error(profileMode.value === 'new' ? 'Bấm "Tạo profile" trước' : 'Chọn profile');
  }
  if (step.value === 2) {
    if (scriptMode.value === 'existing' && !scriptId.value) return ElMessage.error('Chọn script');
    if (scriptMode.value === 'new' && !(await saveScript())) return;
  }
  if (step.value === 3 && parsedInputs.value.error) return ElMessage.error(`Inputs: ${parsedInputs.value.error}`);
  step.value = Math.min(step.value + 1, STEPS.length - 1);
}
const back = () => (step.value = Math.max(0, step.value - 1));

const finalScriptId = computed(() => (scriptMode.value === 'new' ? draftScriptId.value : scriptId.value));
const finalScriptName = computed(() => scripts.value.find((s) => s._id === finalScriptId.value)?.name ?? '');

const saving = ref(false);
async function finish(runNow: boolean) {
  let vars = {};
  try {
    vars = parseJson(run.varsText, 'Biến dùng chung') ?? {};
  } catch (err) {
    return ElMessage.error((err as Error).message);
  }
  const body = {
    name: goal.name.trim(),
    description: goal.description,
    profileId: profileMode.value === 'none' ? '' : profileId.value,
    scriptId: finalScriptId.value,
    inputsText: run.inputsText,
    vars,
    concurrency: run.concurrency,
    headless: run.headless,
    maxRetries: run.maxRetries,
    stepTimeout: run.stepTimeout,
  };
  saving.value = true;
  const flow = await tryApi(() =>
    editId.value ? api<Flow>(`/flows/${editId.value}`, { method: 'PUT', body }) : api<Flow>('/flows', { method: 'POST', body }),
  );
  if (flow && runNow) await tryApi(() => api(`/flows/${flow._id}/run`, { method: 'POST', body: {} }), 'Đã bắt đầu chạy');
  saving.value = false;
  if (flow) navigateTo(`/flows/${flow._id}`);
}

onMounted(async () => {
  const [s, p, sc] = await Promise.all([
    tryApi(() => api<Script[]>('/scripts')),
    tryApi(() => api<Profile[]>('/profiles')),
    tryApi(() => api<object>('/actions/schema')),
  ]);
  scripts.value = s ?? [];
  profiles.value = p ?? [];
  schema.value = sc;
  if (!editId.value) return;
  const flow = await tryApi(() => api<Flow>(`/flows/${editId.value}`));
  if (!flow) return;
  Object.assign(goal, { name: flow.name, description: flow.description, needsLogin: !!flow.profileId });
  profileMode.value = flow.profileId ? 'existing' : 'none';
  profileId.value = flow.profileId ?? '';
  scriptMode.value = 'existing';
  scriptId.value = flow.scriptId;
  Object.assign(run, {
    inputsText: flow.inputsText,
    varsText: Object.keys(flow.vars ?? {}).length ? JSON.stringify(flow.vars, null, 2) : '',
    concurrency: flow.concurrency,
    headless: flow.headless,
    maxRetries: flow.maxRetries,
    stepTimeout: flow.stepTimeout,
  });
});

// Selected script's full actions (list endpoint omits them).
watch(scriptId, async (id) => {
  if (!id) return;
  const full = await tryApi(() => api<Script>(`/scripts/${id}`));
  if (full) scripts.value = scripts.value.map((s) => (s._id === id ? full : s));
});
</script>

<template>
  <div class="page !max-w-6xl">
    <PageHeader
      :title="editId ? 'Sửa luồng' : 'Tạo luồng mới'"
      subtitle="Đi qua từng bước: mục tiêu → profile → script → job & task → xác nhận."
      back="/flows"
    />

    <el-card shadow="never">
      <el-steps :active="step" finish-status="success" align-center>
        <el-step v-for="(s, i) in STEPS" :key="s" :title="s" class="cursor-pointer" @click="i < step && (step = i)" />
      </el-steps>
    </el-card>

    <!-- 1. Goal -->
    <el-card v-show="step === 0" shadow="never" header="1. Mục tiêu của luồng">
      <el-form label-position="top" class="max-w-2xl">
        <el-form-item label="Tên luồng">
          <el-input v-model="goal.name" placeholder="Ví dụ: Lấy bài mới trong nhóm Cầu lông HN" />
        </el-form-item>
        <el-form-item label="Mô tả (không bắt buộc)">
          <el-input v-model="goal.description" type="textarea" :rows="3" placeholder="Luồng này làm gì, lấy dữ liệu gì, chạy khi nào…" />
        </el-form-item>
        <el-form-item label="Trang có cần đăng nhập không?">
          <el-radio-group v-model="goal.needsLogin">
            <el-radio :value="false">Không: trang công khai</el-radio>
            <el-radio :value="true">Có: cần tài khoản (Facebook, Shopee…)</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 2. Profile -->
    <el-card v-show="step === 1" shadow="never" header="2. Profile (Chrome giữ đăng nhập)">
      <el-radio-group v-model="profileMode" class="mb-4">
        <el-radio-button value="existing" :disabled="!profiles.length">Dùng profile có sẵn</el-radio-button>
        <el-radio-button value="new">Tạo profile mới</el-radio-button>
        <el-radio-button value="none">Không dùng profile</el-radio-button>
      </el-radio-group>

      <div v-if="profileMode === 'none'" class="text-sm text-gray-600">
        Mỗi task chạy trong một Chrome mới, sạch trơn (không có đăng nhập). Phù hợp với trang công khai và chạy nhiều task song song.
        <span v-if="goal.needsLogin" class="text-amber-600">Bạn đã chọn "trang cần đăng nhập": nên dùng profile.</span>
      </div>

      <template v-if="profileMode === 'existing'">
        <el-select v-model="profileId" placeholder="Chọn profile" class="!w-96">
          <el-option v-for="p in profiles" :key="p._id" :label="p.name" :value="p._id" :disabled="p.inUse">
            <span>{{ p.name }}</span><span class="ml-2 text-xs text-gray-400">{{ p.notes }}</span>
          </el-option>
        </el-select>
      </template>

      <template v-if="profileMode === 'new'">
        <AiAssistPanel kind="profile" class="!mb-4" placeholder="Ví dụ: profile cho tài khoản Facebook phụ, tiếng Việt" @accept="applyProfileAi" />
        <el-form label-position="top" class="grid max-w-3xl grid-cols-2 gap-x-4">
          <el-form-item label="Tên profile"><el-input v-model="newProfile.name" placeholder="facebook-phu" /></el-form-item>
          <el-form-item label="Ghi chú"><el-input v-model="newProfile.notes" /></el-form-item>
          <el-form-item label="Proxy (không bắt buộc)" class="col-span-2">
            <el-input v-model="newProfile.proxyServer" placeholder="http://host:port hoặc socks5://host:port" />
          </el-form-item>
          <template v-if="newProfile.proxyServer">
            <el-form-item label="Proxy user"><el-input v-model="newProfile.proxyUser" /></el-form-item>
            <el-form-item label="Proxy password"><el-input v-model="newProfile.proxyPass" type="password" show-password /></el-form-item>
          </template>
          <el-form-item label="Emulation (JSON)" class="col-span-2">
            <el-input v-model="newProfile.emulationText" type="textarea" :rows="4" class="font-mono" />
          </el-form-item>
        </el-form>
        <el-button type="primary" :loading="creatingProfile" @click="createProfile">Tạo profile</el-button>
      </template>

      <div v-if="profileMode !== 'none' && selectedProfile" class="mt-4">
        <div class="mb-2 text-sm font-medium">Đăng nhập cho profile "{{ selectedProfile.name }}" (bỏ qua nếu đã đăng nhập trước đó)</div>
        <ProfileLoginBox :key="selectedProfile._id" :profile-id="selectedProfile._id" :profile-name="selectedProfile.name" />
      </div>
    </el-card>

    <!-- 3. Script -->
    <el-card v-show="step === 2" shadow="never" header="3. Script (làm gì trên trang)">
      <el-radio-group v-model="scriptMode" class="mb-4">
        <el-radio-button value="new">Tạo script mới</el-radio-button>
        <el-radio-button value="existing" :disabled="!scripts.length">Dùng script có sẵn</el-radio-button>
      </el-radio-group>

      <AiAssistPanel
        kind="script"
        class="!mb-4"
        :current-form="currentScriptForm"
        allow-snapshot
        :default-profile-id="profileId || undefined"
        start-open
        :placeholder="`Mô tả cần làm gì, ví dụ: ${goal.name || 'mở https://… và lấy tên, giá, link của các sản phẩm'}`"
        @accept="applyScriptAi"
      />

      <template v-if="scriptMode === 'existing'">
        <el-select v-model="scriptId" filterable placeholder="Chọn script" class="!w-96">
          <el-option v-for="s in scripts" :key="s._id" :label="s.name" :value="s._id">
            <span>{{ s.name }}</span><span class="ml-2 text-xs text-gray-400">{{ s.description }}</span>
          </el-option>
        </el-select>
        <div v-if="selectedScript" class="mt-2 text-sm text-gray-600">
          {{ selectedScript.description }} · {{ (selectedScript.actions ?? []).length }} bước ·
          <NuxtLink :to="`/scripts/${selectedScript._id}`" target="_blank">mở trong trình soạn</NuxtLink>
        </div>
      </template>

      <div v-else class="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div class="xl:col-span-2">
          <div class="mb-1 text-sm text-gray-500">Actions</div>
          <JsonEditor v-if="schema" v-model="draft.actionsText" :schema="schema" height="380px" />
        </div>
        <div class="space-y-3">
          <el-input v-model="draft.name" placeholder="Tên script" />
          <el-input v-model="draft.description" type="textarea" :rows="2" placeholder="Mô tả" />
          <div>
            <div class="mb-1 text-sm text-gray-500">Biến mặc định</div>
            <JsonEditor v-model="draft.varsText" height="140px" />
          </div>
          <el-button :loading="savingScript" @click="saveScript">{{ draftScriptId ? 'Lưu thay đổi' : 'Lưu script' }}</el-button>
        </div>
      </div>

      <div class="mt-4 flex items-center gap-3">
        <el-button :loading="testing" @click="testRun">▶ Chạy thử 1 lần (headed{{ profileId ? ', có profile' : '' }})</el-button>
        <span class="text-xs text-gray-500">Chạy với biến mặc định để kiểm tra script trước khi chạy hàng loạt.</span>
      </div>
      <div v-if="testTask" class="mt-3 max-w-md"><TaskCard :task="testTask" new-tab /></div>
    </el-card>

    <!-- 4. Job & tasks -->
    <el-card v-show="step === 3" shadow="never" header="4. Job & task (chạy với những đầu vào nào)">
      <AiAssistPanel
        kind="job"
        class="!mb-4"
        :current-form="currentJobForm"
        placeholder="Ví dụ: chạy cho 3 nhóm này, cuộn 20 lần: https://… https://… https://…"
        @accept="applyJobAi"
      />
      <div class="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span class="text-gray-500">Biến script dùng:</span>
        <el-tag v-for="v in scriptVars" :key="v" size="small" :type="v in activeDefaults ? 'info' : 'warning'">
          {{ v }}{{ v in activeDefaults ? ` = ${String(activeDefaults[v]).slice(0, 40)}` : ' (chưa có giá trị)' }}
        </el-tag>
        <span v-if="!scriptVars.length" class="text-gray-400">(không có)</span>
        <el-button v-if="scriptVars.length" link type="primary" size="small" @click="fillInputsTemplate">Tạo mẫu Inputs</el-button>
      </div>
      <el-input
        v-model="run.inputsText"
        type="textarea"
        :rows="6"
        class="font-mono"
        placeholder="Mỗi dòng là 1 task (CSV có dòng tiêu đề, cột = tên biến; hoặc JSON). Để trống = 1 task dùng biến mặc định."
      />
      <div v-if="parsedInputs.error" class="mt-1 text-sm text-red-600">{{ parsedInputs.error }}</div>
      <el-table v-else-if="parsedInputs.rows.length" :data="parsedInputs.rows.slice(0, 20)" size="small" class="mt-2" max-height="240">
        <el-table-column type="index" label="Task" width="60" />
        <el-table-column v-for="c in inputColumns" :key="c" :label="c" :prop="c" show-overflow-tooltip />
      </el-table>

      <div class="mt-4 grid grid-cols-1 gap-x-6 md:grid-cols-3">
        <el-form label-position="top">
          <el-form-item label="Chạy song song (concurrency)">
            <el-input-number v-model="run.concurrency" :min="1" :max="50" :disabled="!!profileId" />
            <div v-if="profileId" class="text-xs text-gray-500">Dùng profile: các task chạy lần lượt.</div>
          </el-form-item>
        </el-form>
        <el-form label-position="top">
          <el-form-item label="Hiện cửa sổ Chrome">
            <el-switch v-model="run.headless" :active-value="false" :inactive-value="true" active-text="headed" inactive-text="headless" />
          </el-form-item>
        </el-form>
        <el-form label-position="top" class="flex gap-4">
          <el-form-item label="Retries"><el-input-number v-model="run.maxRetries" :min="0" :max="5" /></el-form-item>
          <el-form-item label="Timeout bước (s)"><el-input-number v-model="run.stepTimeout" :min="1" :max="600" /></el-form-item>
        </el-form>
      </div>
      <el-form label-position="top">
        <el-form-item label="Biến dùng chung cho mọi task (JSON, không bắt buộc)">
          <el-input v-model="run.varsText" type="textarea" :rows="2" class="font-mono" placeholder='{ "scrolls": 20 }' />
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 5. Confirm -->
    <el-card v-show="step === 4" shadow="never" header="5. Xác nhận">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="Luồng">{{ goal.name }}<div class="text-xs text-gray-500">{{ goal.description }}</div></el-descriptions-item>
        <el-descriptions-item label="Profile">{{ profileMode === 'none' ? 'Không dùng (Chrome mới cho mỗi task)' : selectedProfile?.name }}</el-descriptions-item>
        <el-descriptions-item label="Script">{{ finalScriptName }}</el-descriptions-item>
        <el-descriptions-item label="Task">{{ taskCount }} task mỗi lần chạy</el-descriptions-item>
        <el-descriptions-item label="Cách chạy">
          {{ profileId ? 'lần lượt (profile)' : `${run.concurrency} song song` }} · {{ run.headless ? 'headless' : 'headed' }} · retries
          {{ run.maxRetries }} · timeout {{ run.stepTimeout }}s
        </el-descriptions-item>
        <el-descriptions-item label="Dữ liệu">Kết quả mỗi lần chạy được tự lưu vào trang <b>Dữ liệu</b>, gộp các mục trùng nhau.</el-descriptions-item>
      </el-descriptions>
      <div class="mt-4 flex gap-2">
        <el-button :loading="saving" @click="finish(false)">Lưu luồng</el-button>
        <el-button type="primary" :loading="saving" @click="finish(true)">Lưu &amp; chạy ngay</el-button>
      </div>
    </el-card>

    <div class="flex justify-between">
      <el-button :disabled="step === 0" @click="back">← Quay lại</el-button>
      <el-button v-if="step < STEPS.length - 1" type="primary" :loading="savingScript" @click="next">Tiếp tục →</el-button>
    </div>
  </div>
</template>
