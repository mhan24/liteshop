<template>
  <AlertDialog :open="confirmState.visible" @update:open="onOpenChange">
    <AlertDialogContent class="max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ confirmState.title || t('common.prompt') }}</AlertDialogTitle>
        <AlertDialogDescription v-if="confirmState.message">{{ confirmState.message }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="settleConfirm(false)">
          {{ confirmState.cancelText || t('common.cancel') }}
        </AlertDialogCancel>
        <AlertDialogAction
          :class="confirmState.danger ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''"
          @click="settleConfirm(true)"
        >
          {{ confirmState.okText || t('common.confirm') }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { confirmState, settleConfirm } from './confirm'

const { t } = useI18n()

function onOpenChange(open: boolean) {
  if (!open) settleConfirm(false)
}
</script>
