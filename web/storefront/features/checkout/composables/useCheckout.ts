import { createOrder as createOrderApi } from '../api'
import type { CreateOrderRequest } from '../types'

// 下单用例：页面只调用 createOrder / pending / error。
export function useCheckout() {
  const pending = ref(false)
  const error = ref('')

  async function createOrder(input: CreateOrderRequest & { turnstileToken: string }) {
    pending.value = true
    error.value = ''
    try {
      return await createOrderApi(input, input.turnstileToken)
    } catch (e: any) {
      error.value = e?.data?.error || e?.message || 'create-order-failed'
      return null
    } finally {
      pending.value = false
    }
  }

  return { createOrder, pending, error }
}
