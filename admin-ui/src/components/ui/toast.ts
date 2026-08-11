import { reactive } from 'vue'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastItem {
  id: number
  type: ToastType
  message: string
}

export const toastList = reactive<ToastItem[]>([])

let seed = 1

export function showToast(message: string, type: ToastType = 'info', duration = 3200) {
  const id = seed++
  toastList.push({ id, type, message })
  if (duration > 0) {
    window.setTimeout(() => dismissToast(id), duration)
  }
}

export const toastSuccess = (m: string) => showToast(m, 'success')
export const toastError = (m: string) => showToast(m, 'error')
export const toastWarning = (m: string) => showToast(m, 'warning')
export const toastInfo = (m: string) => showToast(m, 'info')

export function dismissToast(id: number) {
  const idx = toastList.findIndex((t) => t.id === id)
  if (idx >= 0) toastList.splice(idx, 1)
}
