import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router'
import Layout from '@/layouts/Main.vue'
import Login from '@/features/auth/pages/Login.vue'
import { installAuthGuard } from '@/guards/auth'

// 路由只做页面编排；业务页面按 feature 聚合。
const routes: RouteRecordRaw[] = [
  { path: '/login', component: Login },
  {
    path: '/',
    component: Layout,
    children: [
      { path: '', component: () => import('@/features/dashboard/pages/Dashboard.vue') },
      { path: 'products', component: () => import('@/features/products/pages/Products.vue') },
      { path: 'products/new', component: () => import('@/features/products/pages/ProductForm.vue') },
      { path: 'products/:id/edit', component: () => import('@/features/products/pages/ProductForm.vue') },
      { path: 'products/:id/cards', component: () => import('@/features/inventory/pages/Cards.vue') },
      { path: 'orders', component: () => import('@/features/orders/pages/Orders.vue') },
      { path: 'orders/:id', component: () => import('@/features/orders/pages/Order.vue') },
      { path: 'coupons', component: () => import('@/features/coupons/pages/Coupons.vue') },
      { path: 'settings', component: () => import('@/features/settings/pages/Payment.vue') },
      { path: 'notify', component: () => import('@/features/notifications/pages/Notify.vue') },
      { path: 'site', component: () => import('@/features/settings/pages/Site.vue') },
      { path: 'account', component: () => import('@/features/settings/pages/Account.vue') },
      { path: 'admins', component: () => import('@/features/settings/pages/Admins.vue') },
      { path: 'audit', component: () => import('@/features/settings/pages/AuditLogs.vue') },
      { path: 'system', component: () => import('@/features/settings/pages/System.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes,
})

installAuthGuard(router)

export default router
