import { isValidEmail } from '@/shared/validation'

// 下单表单校验（纯函数，页面只调用）。
export function validateContact(email: string): string | null {
  return isValidEmail(email) ? null : 'invalid-email'
}

export function validateQty(qty: number, min: number, max: number): string | null {
  if (!Number.isFinite(qty) || qty < min) return 'qty-too-small'
  if (max > 0 && qty > max) return 'qty-too-large'
  return null
}
