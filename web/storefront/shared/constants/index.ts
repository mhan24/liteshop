// 全局常量（无业务语义之外的通用值）。
export const API_BASE = '/api/v1'

// 可发送查看链接的订单状态。
export const LINKABLE_STATUSES = [
  'created',
  'waiting_payment',
  'paid',
  'processing',
  'pending_delivery',
  'delivered',
  'completed',
  'delivery_failed',
]

export const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
