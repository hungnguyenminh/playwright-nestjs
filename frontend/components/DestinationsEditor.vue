<script setup lang="ts">
import type { Destination, Platform, Profile } from '~/types/api';

/**
 * Where to post: each destination is a place (own profile / channel, a
 * Facebook Page or Group) with a group of accounts that either all post
 * (staggered) or take turns (one account per slot).
 */
const model = defineModel<Destination[]>({ required: true });
defineProps<{ profiles: Profile[] }>();

const DEFAULT_LIMITS = { minGapPerProfileMinutes: 240, maxPerProfilePerDay: 2, noRepeatPostDays: 30 };
const PLATFORMS: Platform[] = ['facebook', 'threads', 'tiktok', 'youtube'];

function add(platform: Platform, kind: Destination['kind'] = 'self') {
  model.value = [
    ...model.value,
    { platform, kind, url: '', profileIds: [], accountMode: kind === 'self' ? 'all' : 'rotate', rotate: { strategy: 'roundRobin' }, limits: { ...DEFAULT_LIMITS } },
  ];
}
const remove = (i: number) => (model.value = model.value.filter((_, k) => k !== i));
const update = (i: number, d: Destination) => (model.value = model.value.map((x, k) => (k === i ? d : x)));
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm text-slate-600">Thêm điểm đăng:</span>
      <el-button v-for="p in PLATFORMS" :key="p" size="small" @click="add(p)">{{ PLATFORM_ICON[p] }} {{ PLATFORM_LABEL[p] }}</el-button>
      <el-button size="small" @click="add('facebook', 'group')">📘 Nhóm Facebook</el-button>
      <el-button size="small" @click="add('facebook', 'page')">📘 Page Facebook</el-button>
    </div>
    <el-empty v-if="!model.length" description="Chưa có điểm đăng nào" :image-size="50" />
    <DestinationCard
      v-for="(d, i) in model"
      :key="i"
      :model-value="d"
      :index="i"
      :profiles="profiles"
      @update:model-value="(v: Destination) => update(i, v)"
      @remove="remove(i)"
    />
  </div>
</template>
