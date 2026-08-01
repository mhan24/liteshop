export default defineEventHandler((event) => {
  setHeader(event, 'Content-Type', 'image/svg+xml')
  setHeader(event, 'Cache-Control', 'public, max-age=86400')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f6b53"/><text x="32" y="43" font-size="34" font-family="Arial, sans-serif" font-weight="bold" text-anchor="middle" fill="#ffffff">L</text></svg>`
})
