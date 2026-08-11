import { toast } from 'vue-sonner'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export function showToast(message: string, type: ToastType = 'info', duration = 3200) {
  const opts = { duration }
  if (type === 'success') toast.success(message, opts)
  else if (type === 'error') toast.error(message, opts)
  else if (type === 'warning') toast.warning(message, opts)
  else toast.info(message, opts)
}

export const toastSuccess = (m: string) => showToast(m, 'success')
export const toastError = (m: string) => showToast(m, 'error')
export const toastWarning = (m: string) => showToast(m, 'warning')
export const toastInfo = (m: string) => showToast(m, 'info')

export function dismissToast(id: string | number) {
  toast.dismiss(id)
}
