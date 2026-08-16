// 订单/卡密状态 → shadcn Badge 覆盖色（Tailwind 内置色板，不引入额外配色文件）
export function statusBadgeClass(status: string): string {
  if (['paid', 'processing', 'delivered', 'completed', 'available'].includes(status))
    return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
  if (['waiting_payment', 'pending_delivery', 'created', 'locked'].includes(status))
    return 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
  if (['expired', 'payment_failed', 'delivery_failed', 'disabled'].includes(status))
    return 'bg-red-500/15 text-red-700 dark:text-red-400'
  if (status === 'sold') return 'bg-sky-500/15 text-sky-700 dark:text-sky-400'
  return 'bg-muted text-muted-foreground'
}
