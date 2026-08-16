import { reactive } from 'vue'

export interface ConfirmOptions {
  title?: string
  message?: string
  okText?: string
  cancelText?: string
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  visible: boolean
  resolve?: (v: boolean) => void
}

export const confirmState = reactive<ConfirmState>({
  visible: false,
  title: '',
  message: '',
  danger: false,
})

export function confirm(options: ConfirmOptions): Promise<boolean> {
  confirmState.visible = true
  confirmState.title = options.title || ''
  confirmState.message = options.message || ''
  confirmState.okText = options.okText
  confirmState.cancelText = options.cancelText
  confirmState.danger = !!options.danger
  return new Promise<boolean>((resolve) => {
    confirmState.resolve = resolve
  })
}

export function settleConfirm(value: boolean) {
  confirmState.visible = false
  confirmState.resolve?.(value)
  confirmState.resolve = undefined
}
