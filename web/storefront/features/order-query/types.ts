export interface Order {
  id?: number
  order_no: string
  product_id?: number
  product_name: string
  qty: number
  amount_cents: number
  fiat: string
  trade_type?: string
  payment_gateway?: string
  payment_gateway_name?: string
  buyer_contact?: string
  status: string
  payment_status?: string
  trade_id?: string
  payment_url?: string
  block_transaction_id?: string
  delivery_type?: string
  delivery_content?: string
  created_at: number
  updated_at?: number
  paid_at?: number
}

export interface LookupItem {
  order_no: string
  product_name: string
  qty: number
  amount?: string
  fiat?: string
  status: string
  created_at: number
  paid_at?: number
  payment_url?: string
}

export interface OrderDetail {
  order: Order
  cards?: { id: number; content: string }[]
}

export interface SendLinksResult {
  ok: boolean
  sent?: number
}
