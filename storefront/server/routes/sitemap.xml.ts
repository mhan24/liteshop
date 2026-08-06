export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const origin = String(config.public.siteUrl || getRequestURL(event).origin).replace(/\/+$/, '')
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
