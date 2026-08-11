// 订单/卡密状态 → daisyUI badge 样式
export function statusBadgeClass(status: string): string {
  if (['paid', 'processing', 'delivered', 'completed', 'available'].includes(status)) return 'badge-success'
  if (['waiting_payment', 'pending_delivery', 'created', 'locked'].includes(status)) return 'badge-warning'
  if (['expired', 'payment_failed', 'delivery_failed', 'disabled'].includes(status)) return 'badge-error'
  if (status === 'sold') return 'badge-info'
  return 'badge-ghost'
}
