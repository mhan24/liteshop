// 站点对外源（sitemap/canonical/og 用）：
// 优先取 NUXT_PUBLIC_SITE_URL 配置，避免依赖请求 Host（防 Host 头注入/误导）。
export function useSiteOrigin() {
  const config = useRuntimeConfig()
  const req = useRequestURL()
  return computed(() => String(config.public.siteUrl || req.origin).replace(/\/+$/, ''))
}
