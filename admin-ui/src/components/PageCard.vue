<template>
  <el-card v-loading="loading">
    <template #header
      ><h2>{{ title }}</h2></template
    >
    <slot />
  </el-card>
</template>

<script setup lang="ts">
defineProps<{ title?: string; loading?: boolean }>()
</script>
