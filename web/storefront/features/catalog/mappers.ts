import type { Product, ProductView } from './types'

// 商品视图映射（保持展示层与 API 解耦）。
export function toProductView(raw: ProductView): ProductView {
  return raw
}

export function productName(p: Product): string {
  return p.name || '未命名商品'
}
