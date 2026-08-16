// 站点对外源（sitemap/canonical/og 用）：
// 优先取数据库中的 public_base_url（站点设置），未配置时回退请求 Host。
export function useSiteOrigin() {
  const req = useRequestURL()
  const { site } = useSiteConfig()
  return computed(() => String(site.value.public_base_url || req.origin).replace(/\/+$/, ''))
}
