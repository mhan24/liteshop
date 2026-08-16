// 商品目录领域类型（与后端 /api/v1/products|site|pages 对应）。
export interface SiteConfig {
  title: string
  subtitle: string
  announcement?: string
  public_base_url: string
  seo_description?: string
  seo_keywords?: string
  copyright?: string
  lang: 'zh' | 'en'
  locale: string
  currency: string
  currency_symbol: string
  timezone: string
  stock_display_mode: string
  home_view_mode?: 'grid' | 'list'
  default_product_image?: string
  turnstile_site_key?: string
  logo_url?: string
  favicon_url?: string
  links?: { name: string; url: string; category: string }[]
  maintenance?: { enabled: boolean; message?: string }
}

export interface Product {
  id: number
  name: string
  slug?: string
  description?: string
  image_url?: string
  price_cents: number
  status: string
  category?: string
  sort_order?: number
  is_pinned?: boolean
  faq?: { q: string; a: string }[]
  wholesale?: { min_qty: number; discount: number }[]
  min_qty?: number
  max_qty?: number
  delivery_type?: 'auto' | 'manual'
}

export interface ProductView {
  product: Product
  available: number
  reserved?: number
  sold?: number
}

export interface CategoryGroup {
  name: string
  default_key: string
  products: ProductView[]
}

export interface ProductsResult {
  categories: CategoryGroup[]
  categories_all: string[]
}

export interface ProductDetail {
  product: Product
  available: number
  trade_types: string[]
  payment_gateway: string
  payment_gateways: string[]
  payment_gateway_meta: Record<string, { name?: string; description?: string }>
  turnstile_site_key?: string
  default_product_image?: string
}

export interface PageContent {
  content: string
}
