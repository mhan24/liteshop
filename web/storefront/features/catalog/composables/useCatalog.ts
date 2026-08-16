import { getPage, getProduct, getProducts, getSite } from '../api'

// 站点配置（布局/首页使用）。
export function useSite() {
  return useAsyncData('site', () => getSite().catch(() => null))
}

// 商品列表（首页搜索/筛选）。
export function useProducts(params?: () => Record<string, any>) {
  // 固定 key：页面修改筛选后调用 refresh() 重新拉取。
  return useAsyncData('products', () => getProducts(params?.() as any))
}

// 商品详情（商品页）。
export function useProduct(key: () => string) {
  return useAsyncData('product-' + key(), () => getProduct(key()).catch(() => null))
}

// 静态页（隐私政策/服务条款）。
export function usePage(slug: string) {
  return useAsyncData('page-' + slug, () => getPage(slug).catch(() => ({ content: '' })))
}
