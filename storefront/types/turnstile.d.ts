// Cloudflare Turnstile 全局对象（前台商品页/订单查询使用）
interface TurnstileWidget {
  reset: (widget: unknown) => void
  remove: (widget: unknown) => void
}

interface Window {
  turnstile?: {
    render: (container: HTMLElement, options: Record<string, unknown>) => unknown
    reset: (widget: unknown) => void
    remove: (widget: unknown) => void
  }
}
