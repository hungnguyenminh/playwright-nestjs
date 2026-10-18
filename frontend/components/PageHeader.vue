<script setup lang="ts">
/** Consistent page title row: optional back link, title, subtitle, actions on the right. */
const props = defineProps<{ title?: string; subtitle?: string; back?: string }>();
</script>

<template>
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div class="flex min-w-0 items-start gap-3">
      <NuxtLink
        v-if="props.back"
        :to="props.back"
        class="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
        title="Quay lại"
      >
        ←
      </NuxtLink>
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="m-0 truncate text-[19px] font-semibold tracking-tight text-slate-900 sm:text-[22px]">
            <slot name="title">{{ props.title }}</slot>
          </h1>
          <slot name="badge" />
        </div>
        <p v-if="props.subtitle || $slots.subtitle" class="m-0 mt-1 text-sm text-slate-500">
          <slot name="subtitle">{{ props.subtitle }}</slot>
        </p>
      </div>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
