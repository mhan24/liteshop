export default defineEventHandler(async (event) => {
  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  return [`User-agent: *`, `Disallow: /admin`, `Disallow: /api`, `Disallow: /order`, `Disallow: /setup`, ``].join('\n')
})
