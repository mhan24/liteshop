import { http } from '@/services/http/client'
import type { PageContent, ProductDetail, ProductsResult, SiteConfig } from './types'

// 商品目录业务 API（页面不直接 $fetch，统一走这里）。
export function getSite() {
  return http.get<SiteConfig>('/site')
}

export function getProducts(params?: { q?: string; category?: string; min_price?: string; max_price?: string }) {
  return http.get<ProductsResult>('/products', params)
}

export function getProduct(key: string) {
  return http.get<ProductDetail>('/products/' + encodeURIComponent(key))
}

export function getPage(slug: string) {
  return http.get<PageContent>('/pages/' + slug)
}
