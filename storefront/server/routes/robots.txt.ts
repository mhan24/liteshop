export default defineEventHandler(async (event) => {
  const reqOrigin = String(getRequestURL(event).origin).replace(/\/+$/, '')
  let origin = reqOrigin
  try {
    const site: any = await $fetch(reqOrigin + '/api/v1/site')
    if (site?.public_base_url) origin = String(site.public_base_url).replace(/\/+$/, '')
  } catch {
    /* 忽略站点配置获取失败，返回默认 robots */
  }
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')
  return [
    `User-agent: *`,
    `Disallow: /admin`,
    `Disallow: /api`,
    `Disallow: /order`,
    `Disallow: /setup`,
    ``,
    `Sitemap: ${origin}/sitemap.xml`,
    ``,
  ].join('\n')
})
