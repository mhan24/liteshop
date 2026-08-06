export default defineNuxtConfig({
  devServer: { port: 3001, host: '127.0.0.1' },
  runtimeConfig: {
    public: { apiBase: '/api/v1', siteUrl: '' },
  },
  nitro: {
    devProxy: {
      '/api/': { target: 'http://127.0.0.1:8080/api/', changeOrigin: true },
    },
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
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },
})
