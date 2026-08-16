import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-08-11',
  devServer: { port: 3001, host: '127.0.0.1' },
  // shadcn-vue 组件目录含 index.ts 与 .vue 同名文件，关闭 Nuxt 组件自动扫描，
  // 页面/布局中全部组件均显式导入，避免重复注册告警
  components: false,
  runtimeConfig: {
    // SSR 必须使用完整地址；生产可通过 NUXT_API_BASE 指向本机 Go 服务。
    apiBase: 'http://127.0.0.1:8080/api/v1',
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
  vite: {
    plugins: [tailwindcss()],
  },
  app: {
    head: {
      title: 'LiteShop',
      htmlAttrs: { lang: 'zh-CN' },
      // key: 'icon' 让后台设置的自定义 favicon（layouts/default.vue）可覆盖内置图标，避免重复输出
      link: [{ rel: 'icon', key: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      meta: [{ charset: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
})
