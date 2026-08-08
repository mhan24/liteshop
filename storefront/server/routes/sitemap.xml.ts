export default defineEventHandler(async (event) => {
  const reqOrigin = String(getRequestURL(event).origin).replace(/\/+$/, '')
  // 站点源取自数据库配置（public_base_url），避免依赖 Host/环境变量。
  let origin = reqOrigin
  try {
    const site: any = await $fetch(reqOrigin + '/api/v1/site')
    if (site?.public_base_url) origin = String(site.public_base_url).replace(/\/+$/, '')
  } catch {}
  let urls: string[] = []
  try {
    const data: any = await $fetch(origin + '/api/v1/products')
    for (const cat of data.categories || []) {
      for (const p of cat.products || []) {
        const slug = p.product.slug && p.product.slug !== 'p' ? encodeURIComponent(p.product.slug) : p.product.id
        urls.push(`/product/${slug}`)
      }
    }
  } catch {}
  const items = ['/', '/order', '/page/privacy', '/page/terms', ...urls]
    .map((p) => `  <url><loc>${origin}${p}</loc></url>`)
    .join('\n')
  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>`
})
