<script lang="ts">
// Diagnostics options are global to Monaco: keep one schema entry per editor.
const schemas = new Map<string, { uri: string; fileMatch: string[]; schema: object }>();
let seq = 0;
</script>

<script setup lang="ts">
import type * as Monaco from 'monaco-editor';

/**
 * Monaco JSON editor; with `schema` it validates and autocompletes against it
 * (the action DSL schema from GET /actions/schema).
 */
const props = withDefaults(
  defineProps<{ modelValue: string; schema?: object; height?: string; readOnly?: boolean }>(),
  { height: '400px', readOnly: false },
);
const emit = defineEmits<{ 'update:modelValue': [string]; markers: [number] }>();

const el = ref<HTMLElement>();
let editor: Monaco.editor.IStandaloneCodeEditor | undefined;
let model: Monaco.editor.ITextModel | undefined;
let monaco: typeof Monaco | undefined;
let markerSub: Monaco.IDisposable | undefined;

async function loadMonaco() {
  const [m, { default: EditorWorker }, { default: JsonWorker }] = await Promise.all([
    import('monaco-editor'),
    import('monaco-editor/editor/editor.worker?worker'),
    import('monaco-editor/language/json/json.worker?worker'),
  ]);
  (self as any).MonacoEnvironment = {
    getWorker: (_: string, label: string) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
  };
  return m;
}

function applySchemas() {
  monaco?.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    schemas: [...schemas.values()],
  });
}

onMounted(async () => {
  monaco = await loadMonaco();
  const uri = monaco.Uri.parse(`inmemory://editor/${++seq}.json`);
  model = monaco.editor.createModel(props.modelValue, 'json', uri);
  if (props.schema) {
    // Structured-cloned into the worker: pass a plain copy, not a Vue proxy.
    const schema = JSON.parse(JSON.stringify(props.schema));
    schemas.set(uri.toString(), { uri: `schema://${seq}`, fileMatch: [uri.toString()], schema });
    applySchemas();
  }
  editor = monaco.editor.create(el.value!, {
    model,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    tabSize: 2,
    scrollBeyondLastLine: false,
    readOnly: props.readOnly,
    fixedOverflowWidgets: true,
  });
  model.onDidChangeContent(() => emit('update:modelValue', model!.getValue()));
  markerSub = monaco.editor.onDidChangeMarkers((uris) => {
    if (uris.some((u) => u.toString() === uri.toString())) {
      emit('markers', monaco!.editor.getModelMarkers({ resource: uri }).length);
    }
  });
});

watch(
  () => props.modelValue,
  (v) => {
    if (model && v !== model.getValue()) model.setValue(v);
  },
);

onBeforeUnmount(() => {
  if (model) schemas.delete(model.uri.toString());
  applySchemas();
  markerSub?.dispose();
  editor?.dispose();
  model?.dispose();
});
</script>

<template>
  <div ref="el" class="overflow-hidden rounded border border-gray-300" :style="{ height: props.height }" />
</template>
