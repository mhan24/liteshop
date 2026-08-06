export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const origin = String(config.public.siteUrl || getRequestURL(event).origin).replace(/\/+$/, '')
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
