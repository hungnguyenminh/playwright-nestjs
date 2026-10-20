<script setup lang="ts">
const route = useRoute();
const id = computed(() => route.params.id as string);
</script>

<template>
  <div class="page">
    <PageHeader title="Sửa bài viết" subtitle="Thay đổi có hiệu lực với các lượt đăng chưa chạy." back="/publish/posts" />
    <PostEditor :id="id" :key="id" />
  </div>
</template>
