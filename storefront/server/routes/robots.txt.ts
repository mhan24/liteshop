export default defineEventHandler(async (event) => {
  const origin = getRequestURL(event).origin
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
