<template>
  <div v-if="total > 0" class="mt-4 flex items-center justify-end gap-3">
    <span class="text-sm text-muted-foreground">{{ t('pagination.total', { total }) }}</span>
    <div class="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        class="h-8 w-8"
        :disabled="page <= 1"
        @click="emit('update:page', page - 1)"
      >
        <ChevronLeft class="h-4 w-4" />
      </Button>
      <Button
        v-for="p in pages"
        :key="p"
        :variant="p === page ? 'default' : 'outline'"
        size="icon"
        class="h-8 w-8"
        :disabled="p < 0"
        @click="emit('update:page', p)"
      >
        {{ p < 0 ? '…' : p }}
      </Button>
      <Button
        variant="outline"
        size="icon"
        class="h-8 w-8"
        :disabled="page >= pageCount"
        @click="emit('update:page', page + 1)"
      >
        <ChevronRight class="h-4 w-4" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { Button } from '@/shared/components/ui/button'

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
