export default defineNuxtConfig({
  devServer: { port: 3001, host: '127.0.0.1' },
  runtimeConfig: {
    public: { apiBase: '/api/v1' },
  },
  nitro: {
    devProxy: {
      '/api/': { target: 'http://127.0.0.1:8080/api/', changeOrigin: true },
    },
  },
  routeRules: {
    // 动态页面不缓存，避免浏览器/CDN 端出旧页面（如订单/商品页的旧跳转逻辑）
    '/': { headers: { 'cache-control': 'no-store' } },
    '/order/**': { headers: { 'cache-control': 'no-store' } },
    '/product/**': { headers: { 'cache-control': 'no-store' } },
    '/page/**': { headers: { 'cache-control': 'no-store' } },
    '/setup': { headers: { 'cache-control': 'no-store' } },
  },
  css: ['~/assets/css/main.css'],
  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  },
  app: {
    head: {
      title: 'LiteShop',
      htmlAttrs: { lang: 'zh-CN' },
      // key: 'icon' 让后台设置的自定义 favicon（layouts/default.vue）可覆盖内置图标，避免重复输出
      link: [{ rel: 'icon', key: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },
})
