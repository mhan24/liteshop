<template>
  <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
    <div v-if="title" class="card-body !pb-2">
      <h2 class="card-title text-lg">{{ title }}</h2>
    </div>
    <div class="card-body" :class="title ? '!pt-3' : ''">
      <div v-if="loading" class="flex justify-center py-10">
        <span class="loading loading-spinner loading-lg text-primary"></span>
      </div>
      <slot v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
    loading?: boolean
  }>(),
  {
    title: '',
    loading: false,
  },
)
</script>
