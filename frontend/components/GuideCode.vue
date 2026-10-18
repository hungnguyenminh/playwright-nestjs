<script setup lang="ts">
/** Code sample with a copy button, used by the guide page. */
const props = defineProps<{ code: string; title?: string }>();
const copied = ref(false);

async function copy() {
  await navigator.clipboard.writeText(props.code);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="my-3 overflow-hidden rounded border border-gray-200">
    <div class="flex items-center justify-between bg-gray-100 px-3 py-1 text-xs text-gray-500">
      <span>{{ props.title ?? 'JSON' }}</span>
      <el-button link size="small" @click="copy">{{ copied ? 'Đã copy' : 'Copy' }}</el-button>
    </div>
    <pre class="m-0 overflow-auto bg-gray-950 p-3 text-xs leading-5 text-gray-100">{{ props.code }}</pre>
  </div>
</template>
