import { http } from '@/services/http/client'
import type { Order, SendLinksResult } from './types'

// 订单查询/查单链接业务 API。
export function getOrderDetail(orderNo: string, query?: Record<string, string | undefined>) {
  return http.get<{ order: Order; cards?: { id: number; content: string }[] }>(
    '/orders/' + encodeURIComponent(orderNo),
    query,
  )
}

export function sendLinks(contact: string, orderNos: string[], turnstileToken: string) {
  return http.post<SendLinksResult>(
    '/orders/links',
    orderNos.length ? { contact, order_nos: orderNos } : { contact },
    turnstileToken ? { 'X-Turnstile-Response': turnstileToken } : undefined,
  )
}

export function sendSingleLink(contact: string, orderNo: string, turnstileToken: string) {
  return http.post<SendLinksResult>(
    '/orders/links',
    { contact, order_no: orderNo },
    turnstileToken ? { 'X-Turnstile-Response': turnstileToken } : undefined,
  )
}

export function cancelOrder(orderNo: string, query: string) {
  return http.post<{ ok: boolean }>('/orders/' + encodeURIComponent(orderNo) + '/cancel?' + query)
}
