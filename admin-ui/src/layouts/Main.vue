<template>
  <div class="min-h-screen bg-base-200">
    <!-- 移动端遮罩 -->
    <div
      v-if="mobileOpen"
      class="fixed inset-0 z-30 bg-black/50 md:hidden"
      @click="mobileOpen = false"
    ></div>

    <!-- 侧边栏 -->
    <aside
      class="fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-neutral text-neutral-content transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0 md:transition-[width]"
      :class="[!isMobile && collapsed ? 'md:w-[68px]' : 'md:w-60', isMobile && !mobileOpen ? '-translate-x-full' : 'translate-x-0']"
    >
      <div class="flex h-16 shrink-0 items-center gap-2 border-b border-white/10 px-4">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-content">
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </div>
        <span v-show="!collapsed || isMobile" class="truncate text-base font-bold">{{ t('app.title') }}</span>
      </div>

      <nav class="flex-1 space-y-1 overflow-y-auto p-3">
        <router-link
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors"
          :class="activeMenu === item.to ? 'bg-primary font-medium text-primary-content' : 'hover:bg-white/10'"
        >
          <component :is="item.icon" class="h-5 w-5 shrink-0" />
          <span v-show="!collapsed || isMobile" class="truncate">{{ t(item.label) }}</span>
        </router-link>

        <div v-show="!collapsed || isMobile" class="!mt-4 px-3 pt-3 text-xs uppercase tracking-wider opacity-50">
          {{ t('nav.manage') }}
        </div>

        <router-link
          v-for="item in manageItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors"
          :class="activeMenu === item.to ? 'bg-primary font-medium text-primary-content' : 'hover:bg-white/10'"
        >
          <component :is="item.icon" class="h-5 w-5 shrink-0" />
          <span v-show="!collapsed || isMobile" class="truncate">{{ t(item.label) }}</span>
        </router-link>
      </nav>

      <div class="shrink-0 space-y-1 border-t border-white/10 p-3">
        <a
          href="/"
          target="_blank"
          rel="noopener"
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-white/10"
        >
          <LinkIcon class="h-5 w-5 shrink-0" />
          <span v-show="!collapsed || isMobile" class="truncate">{{ t('nav.front') }}</span>
        </a>
        <button
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-white/10"
          @click="onLogout"
        >
          <LogOut class="h-5 w-5 shrink-0" />
          <span v-show="!collapsed || isMobile" class="truncate">{{ t('nav.logout') }}</span>
        </button>
      </div>
    </aside>

    <!-- 主区域 -->
    <div class="flex min-h-screen flex-col md:pl-0">
      <header
        class="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-base-300 bg-base-100/95 px-4 backdrop-blur"
      >
        <button class="btn btn-ghost btn-circle btn-sm" @click="toggleSidebar">
          <ChevronsRight v-if="sidebarHidden" class="h-5 w-5" />
          <ChevronsLeft v-else class="h-5 w-5" />
        </button>

        <div class="hidden text-sm opacity-60 md:block">{{ currentTitle }}</div>
        <div class="flex-1"></div>

        <div class="join join-sm">
          <button
            class="join-item btn btn-sm"
            :class="locale === 'zh' ? 'btn-primary' : 'btn-ghost'"
            @click="locale = 'zh'"
          >
            中文
          </button>
          <button
            class="join-item btn btn-sm"
            :class="locale === 'en' ? 'btn-primary' : 'btn-ghost'"
            @click="locale = 'en'"
          >
            EN
          </button>
        </div>

        <div class="dropdown dropdown-end">
          <div tabindex="0" role="button" class="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-base-200">
            <div class="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-content">
              {{ (username || 'A').slice(0, 1).toUpperCase() }}
            </div>
            <div class="hidden text-left sm:block">
              <div class="text-sm font-medium leading-tight">{{ username }}</div>
              <div class="text-xs opacity-60">{{ roleLabel }}</div>
            </div>
          </div>
          <ul tabindex="0" class="menu dropdown-content z-50 mt-2 w-44 rounded-box bg-base-100 p-2 shadow-lg ring-1 ring-base-300">
            <li><router-link to="/account">{{ t('nav.account') }}</router-link></li>
            <li><a @click="onLogout">{{ t('nav.logout') }}</a></li>
          </ul>
        </div>
      </header>

      <main class="flex-1 p-4 md:p-6">
        <router-view v-slot="{ Component }">
          <transition name="page-fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useLocalStorage, useMediaQuery } from '@vueuse/core'
import {
  Home,
  Package,
  ListOrdered,
  Wallet,
  Bell,
  Settings,
  User,
  Wrench,
  ExternalLink as LinkIcon,
  LogOut,
  ChevronsRight,
  ChevronsLeft,
  Users,
  ScrollText,
  Ticket,
} from '@lucide/vue'
import { useSession } from '@/hooks/useSession'
import { confirm } from '@/components/ui/confirm'

const route = useRoute()
const router = useRouter()
const { isAdmin, username, logout: doLogout } = useSession()
const { t, locale } = useI18n()

const collapsed = useLocalStorage('liteshop_admin_sidebar', false)
const mobileOpen = ref(false)
const isMobile = useMediaQuery('(max-width: 767px)')

watch(
  isMobile,
  (mobile) => {
    if (mobile) collapsed.value = true
    else mobileOpen.value = false
  },
  { immediate: true },
)

const sidebarHidden = computed(() => (isMobile.value ? !mobileOpen.value : collapsed.value))

function toggleSidebar() {
  if (isMobile.value) mobileOpen.value = !mobileOpen.value
  else collapsed.value = !collapsed.value
}

const navItems = computed(() => [
  { to: '/', label: 'nav.home', icon: Home },
  { to: '/products', label: 'nav.products', icon: Package },
  { to: '/orders', label: 'nav.orders', icon: ListOrdered },
  { to: '/coupons', label: 'nav.coupons', icon: Ticket },
  { to: '/settings', label: 'nav.payment', icon: Wallet },
])

const manageItems = computed(() => {
  const items = [
    { to: '/notify', label: 'nav.notify', icon: Bell },
    { to: '/site', label: 'nav.site', icon: Settings },
    { to: '/account', label: 'nav.account', icon: User },
    { to: '/system', label: 'nav.system', icon: Wrench },
  ]
  if (isAdmin.value) {
    items.splice(3, 0, { to: '/admins', label: 'nav.admins', icon: Users })
    items.splice(4, 0, { to: '/audit', label: 'nav.audit', icon: ScrollText })
  }
  return items
})

const activeMenu = computed(() => {
  if (route.path.startsWith('/products')) return '/products'
  if (route.path.startsWith('/orders')) return '/orders'
  return route.path
})

const currentTitle = computed(() => {
  const all = [...navItems.value, ...manageItems.value]
  const item = all.find((i) => i.to === activeMenu.value)
  return item ? t(item.label) : ''
})

const roleLabel = computed(() => {
  const { role } = useSession()
  return t(`admins.role${role.value === 'admin' ? 'Admin' : role.value === 'operator' ? 'Operator' : 'Viewer'}`)
})

async function onLogout() {
  const ok = await confirm({
    title: t('nav.logout'),
    message: t('nav.logoutConfirm'),
    danger: false,
  })
  if (!ok) return
  await doLogout()
  router.push('/login')
}
</script>
