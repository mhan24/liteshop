import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import Layout from '@/layouts/Main.vue'
import Login from '@/views/Login.vue'

const routes: RouteRecordRaw[] = [
  { path: '/login', component: Login },
  {
    path: '/',
    component: Layout,
    children: [
      { path: '', component: () => import('@/views/Dashboard.vue') },
      { path: 'products', component: () => import('@/views/Products.vue') },
      { path: 'products/new', component: () => import('@/views/ProductForm.vue') },
      { path: 'products/:id/edit', component: () => import('@/views/ProductForm.vue') },
      { path: 'products/:id/cards', component: () => import('@/views/Cards.vue') },
      { path: 'orders', component: () => import('@/views/Orders.vue') },
      { path: 'orders/:id', component: () => import('@/views/Order.vue') },
      { path: 'settings', component: () => import('@/views/Payment.vue') },
      { path: 'notify', component: () => import('@/views/Notify.vue') },
      { path: 'site', component: () => import('@/views/Site.vue') },
      { path: 'account', component: () => import('@/views/Account.vue') },
      { path: 'admins', component: () => import('@/views/Admins.vue') },
      { path: 'audit', component: () => import('@/views/AuditLogs.vue') },
      { path: 'system', component: () => import('@/views/System.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes,
})

router.beforeEach(async (to) => {
  const store = (await import('@/stores/session')).useSessionStore()
  if (to.path === '/login') {
    if (!store.checked) await store.check()
    if (store.authed) return '/'
    return true
  }
  if (!store.checked) await store.check()
  if (!store.authed) return '/login'
  return true
})

export default router
