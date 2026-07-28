import { createRouter, createWebHistory } from 'vue-router'
import Setup from '@/views/Setup.vue'
import PublicLayout from '@/PublicLayout.vue'
import Home from '@/views/Home.vue'
import Product from '@/views/Product.vue'
import OrderLookup from '@/views/OrderLookup.vue'
import Order from '@/views/Order.vue'
import Page from '@/views/Page.vue'
import AdminLogin from '@/views/admin/Login.vue'
import AdminLayout from '@/views/admin/Layout.vue'
import AdminDashboard from '@/views/admin/Dashboard.vue'
import AdminProducts from '@/views/admin/Products.vue'
import AdminProductForm from '@/views/admin/ProductForm.vue'
import AdminCards from '@/views/admin/Cards.vue'
import AdminOrders from '@/views/admin/Orders.vue'
import AdminOrder from '@/views/admin/Order.vue'
import AdminPayment from '@/views/admin/Payment.vue'
import AdminNotify from '@/views/admin/Notify.vue'
import AdminSite from '@/views/admin/Site.vue'
import AdminAccount from '@/views/admin/Account.vue'
import AdminSystem from '@/views/admin/System.vue'

const routes = [
  { path: '/setup', component: Setup },
  {
    path: '/',
    component: PublicLayout,
    children: [
      { path: '', component: Home },
      { path: 'product/:id', component: Product },
      { path: 'order', component: OrderLookup },
      { path: 'order/:orderNo', component: Order },
      { path: 'page/:slug', component: Page },
    ],
  },
  { path: '/admin/login', component: AdminLogin },
  {
    path: '/admin',
    component: AdminLayout,
    children: [
      { path: '', component: AdminDashboard },
      { path: 'products', component: AdminProducts },
      { path: 'products/new', component: AdminProductForm },
      { path: 'products/:id/edit', component: AdminProductForm },
      { path: 'products/:id/cards', component: AdminCards },
      { path: 'orders', component: AdminOrders },
      { path: 'orders/:id', component: AdminOrder },
      { path: 'settings', component: AdminPayment },
      { path: 'notify', component: AdminNotify },
      { path: 'site', component: AdminSite },
      { path: 'account', component: AdminAccount },
      { path: 'system', component: AdminSystem },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export default createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})
