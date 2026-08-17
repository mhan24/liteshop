<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="max-w-sm">
      <div class="flex flex-col items-center gap-3 py-4 text-center">
        <component
          :is="icon"
          :class="['h-12 w-12', iconColor]"
        />
        <DialogTitle v-if="title" class="text-lg font-semibold">{{ title }}</DialogTitle>
        <DialogDescription class="text-sm whitespace-pre-line">{{ message }}</DialogDescription>
      </div>
      <DialogFooter class="sm:justify-center">
        <Button @click="close">{{ okText || t('common.confirm') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckCircle2, XCircle, AlertTriangle } from '@lucide/vue'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'

const props = withDefaults(
  defineProps<{
    open: boolean
    type?: 'success' | 'error' | 'warning'
    title?: string
    message?: string
    okText?: string
  }>(),
  {
    type: 'success',
    title: '',
    message: '',
    okText: '',
  },
)

const emit = defineEmits<{ 'update:open': [v: boolean]; close: [] }>()

const { t } = useI18n()

const icon = computed(() => {
  if (props.type === 'error') return XCircle
  if (props.type === 'warning') return AlertTriangle
  return CheckCircle2
})

const iconColor = computed(() => {
  if (props.type === 'error') return 'text-destructive'
  if (props.type === 'warning') return 'text-yellow-500'
  return 'text-emerald-500'
})

function close() {
  emit('update:open', false)
  emit('close')
}
</script>