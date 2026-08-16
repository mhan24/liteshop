<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogScrollContent class="max-w-lg">
      <DialogHeader v-if="title">
        <DialogTitle>{{ title }}</DialogTitle>
      </DialogHeader>
      <div class="py-2">
        <slot />
      </div>
      <DialogFooter v-if="showFooter">
        <slot name="footer">
          <Button variant="outline" :disabled="loading" @click="close">
            {{ t('common.cancel') }}
          </Button>
          <Button :disabled="loading" @click="$emit('confirm')">
            <Loader2 v-if="loading" class="animate-spin" />
            {{ t('common.confirm') }}
          </Button>
        </slot>
      </DialogFooter>
    </DialogScrollContent>
  </Dialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { Dialog, DialogFooter, DialogHeader, DialogScrollContent, DialogTitle } from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'

withDefaults(
  defineProps<{
    open: boolean
    title?: string
    loading?: boolean
    showFooter?: boolean
  }>(),
  {
    title: '',
    loading: false,
    showFooter: true,
  },
)

const emit = defineEmits<{
  'update:open': [v: boolean]
  close: []
  confirm: []
}>()

const { t } = useI18n()

function onOpenChange(open: boolean) {
  emit('update:open', open)
  if (!open) emit('close')
}

function close() {
  emit('update:open', false)
  emit('close')
}
</script>
