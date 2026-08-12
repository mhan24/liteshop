<template>
  <AlertDialog :open="confirmState.visible" @update:open="onOpenChange">
    <AlertDialogContent class="max-w-md">
      <AlertDialogHeader>
        <AlertDialogTitle>{{ confirmState.title || t('common.prompt') }}</AlertDialogTitle>
        <AlertDialogDescription v-if="confirmState.message">{{ confirmState.message }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click.capture="doSettle(false)">
          {{ confirmState.cancelText || t('common.cancel') }}
        </AlertDialogCancel>
        <AlertDialogAction
          :class="confirmState.danger ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''"
          @click.capture="doSettle(true)"
        >
          {{ confirmState.okText || t('common.confirm') }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<script setup lang="ts">
import { watch } from 'vue'
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

// 防止 reka-ui 关闭弹窗（update:open=false）与按钮点击之间的事件顺序竞态：
// 按钮用捕获阶段优先结算一次，后续 close 事件不再覆盖结果。
let settled = false
watch(
  () => confirmState.visible,
  (v) => {
    if (v) settled = false
  },
)

function doSettle(value: boolean) {
  if (settled) return
  settled = true
  settleConfirm(value)
}

function onOpenChange(open: boolean) {
  if (!open) doSettle(false)
}
</script>
