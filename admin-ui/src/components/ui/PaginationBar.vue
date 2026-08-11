<template>
  <div v-if="total > 0" class="mt-4 flex items-center justify-end gap-3">
    <span class="text-sm opacity-60">{{ t('pagination.total', { total }) }}</span>
    <div class="join">
      <button class="join-item btn btn-sm" :disabled="page <= 1" @click="emit('update:page', page - 1)">
        «
      </button>
      <template v-for="p in pages" :key="p">
        <button
          class="join-item btn btn-sm"
          :class="{ 'btn-active': p === page }"
          @click="emit('update:page', p)"
        >
          {{ p }}
        </button>
      </template>
      <button
        class="join-item btn btn-sm"
        :disabled="page >= pageCount"
        @click="emit('update:page', page + 1)"
      >
        »
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  total: number
  page: number
  pageSize: number
}>()

const emit = defineEmits<{
  'update:page': [p: number]
}>()

const { t } = useI18n()

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))

const pages = computed(() => {
  const count = pageCount.value
  const current = props.page
  if (count <= 7) {
    return Array.from({ length: count }, (_, i) => i + 1)
  }
  const list: number[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(count - 1, current + 1)
  if (start > 2) list.push(-1)
  for (let p = start; p <= end; p++) list.push(p)
  if (end < count - 1) list.push(-2)
  list.push(count)
  return list
})
</script>
