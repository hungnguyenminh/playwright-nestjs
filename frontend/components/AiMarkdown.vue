<script setup lang="ts">
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

/** Renders model-written markdown. Raw HTML is disabled and the output sanitized. */
const props = defineProps<{ source: string }>();
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const html = computed(() => DOMPurify.sanitize(md.render(props.source)));
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- sanitized above -->
  <div class="ai-md" v-html="html" />
</template>

<style scoped>
.ai-md :deep(h1),
.ai-md :deep(h2),
.ai-md :deep(h3) {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0.8em 0 0.3em;
}
.ai-md :deep(p) {
  margin: 0.3em 0;
}
.ai-md :deep(ul),
.ai-md :deep(ol) {
  margin: 0.3em 0;
  padding-left: 1.4em;
}
.ai-md :deep(code) {
  background: var(--el-fill-color-light);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 0.85em;
}
.ai-md :deep(pre) {
  background: #0b1021;
  color: #e5e7eb;
  padding: 8px;
  border-radius: 6px;
  overflow: auto;
  font-size: 12px;
}
.ai-md :deep(pre code) {
  background: none;
  padding: 0;
}
.ai-md :deep(hr) {
  border: none;
  border-top: 1px dashed var(--el-border-color);
  margin: 0.8em 0;
}
</style>
