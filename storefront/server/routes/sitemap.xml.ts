export default defineEventHandler(async (event) => {
  const origin = getRequestURL(event).origin
  let urls: string[] = []
  try {
    const data: any = await $fetch(origin + '/api/v1/products')
    for (const cat of data.categories || []) {
      for (const p of cat.products || []) {
        urls.push(`/product/${p.product.id}`)
      }
    }
  } catch {}
  const items = ['/', '/order', '/page/privacy', '/page/terms', ...urls]
    .map((p) => `  <url><loc>${origin}${p}</loc></url>`)
    .join('\n')
  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>`
})
