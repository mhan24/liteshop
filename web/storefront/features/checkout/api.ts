import { http } from '@/services/http/client'
import type { CreateOrderRequest, CreateOrderResponse } from './types'

// 下单业务 API（页面统一走这里）。
export function createOrder(payload: CreateOrderRequest, turnstileToken: string) {
  return http.post<CreateOrderResponse>('/orders', {
    ...payload,
    'cf-turnstile-response': turnstileToken,
  })
}
