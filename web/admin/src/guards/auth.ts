import type { Router } from 'vue-router'
import { useSessionStore } from '@/stores/session'

// 登录态守卫：未登录跳转 /login，已登录访问 /login 跳回首页。
export function installAuthGuard(router: Router) {
  router.beforeEach(async (to) => {
    const store = useSessionStore()
    if (to.path === '/login') {
      if (!store.checked) await store.check()
      if (store.authed) return '/'
      return true
    }
    if (!store.checked) await store.check()
    if (!store.authed) return '/login'
    return true
  })
}
