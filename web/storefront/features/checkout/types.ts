export interface CreateOrderRequest {
  product_id: number
  qty: number
  contact: string
  trade_type: string
  gateway: string
  coupon_code?: string
  'cf-turnstile-response'?: string
}

export interface CreateOrderResponse {
  order_no: string
  payment_url: string
  token: string
}
