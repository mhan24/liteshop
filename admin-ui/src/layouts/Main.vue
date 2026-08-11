<template>
  <div class="flex min-h-screen bg-muted/30">
    <!-- 移动端抽屉 -->
    <Sheet :open="mobileOpen" @update:open="mobileOpen = $event">
      <SheetContent side="left" class="w-64 p-0">
        <SideNav :collapsed="false" :active-menu="activeMenu" @logout="onLogout" />
      </SheetContent>
    </Sheet>

    <!-- 桌面侧边栏 -->
    <aside
      v-if="!isMobile"
      class="sticky top-0 hidden h-screen shrink-0 border-r bg-background md:block"
      :class="collapsed ? 'w-[68px]' : 'w-60'"
    >
      <SideNav :collapsed="collapsed" :active-menu="activeMenu" @logout="onLogout" />
    </aside>

    <div class="flex min-h-screen flex-1 flex-col">
      <header class="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
        <Button variant="ghost" size="icon" @click="toggleSidebar">
          <Menu v-if="isMobile" class="h-5 w-5" />
          <PanelLeft v-else-if="!collapsed" class="h-5 w-5" />
          <PanelLeftOpen v-else class="h-5 w-5" />
        </Button>

        <div class="hidden text-sm text-muted-foreground md:block">{{ currentTitle }}</div>
        <div class="flex-1"></div>

        <div class="flex items-center gap-1">
          <Button :variant="locale === 'zh' ? 'secondary' : 'ghost'" size="sm" @click="locale = 'zh'">
            中文
          </Button>
          <Button :variant="locale === 'en' ? 'secondary' : 'ghost'" size="sm" @click="locale = 'en'">
            EN
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" class="gap-2 px-2">
              <Avatar class="h-8 w-8">
                <AvatarFallback>{{ (username || 'A').slice(0, 1).toUpperCase() }}</AvatarFallback>
              </Avatar>
              <span class="hidden sm:block">{{ username }}</span>
              <ChevronDown class="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-44">
            <DropdownMenuLabel>{{ roleLabel }}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="router.push('/account')">
              <User class="h-4 w-4" />
              {{ t('nav.account') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="onLogout">
              <LogOut class="h-4 w-4" />
              {{ t('nav.logout') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
import { ChevronDown, LogOut, Menu, PanelLeft, PanelLeftOpen, User } from '@lucide/vue'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import SideNav from '@/components/SideNav.vue'
import { useSession } from '@/hooks/useSession'
import { confirm } from '@/components/ui/confirm'

const route = useRoute()
const router = useRouter()
const { username, role, logout: doLogout } = useSession()
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

function toggleSidebar() {
  if (isMobile.value) mobileOpen.value = !mobileOpen.value
  else collapsed.value = !collapsed.value
}

const activeMenu = computed(() => {
  if (route.path.startsWith('/products')) return '/products'
  if (route.path.startsWith('/orders')) return '/orders'
  return route.path
})

const currentTitle = computed(() => {
  const map: Record<string, string> = {
    '/': 'nav.home',
    '/products': 'nav.products',
    '/orders': 'nav.orders',
    '/coupons': 'nav.coupons',
    '/settings': 'nav.payment',
    '/notify': 'nav.notify',
    '/site': 'nav.site',
    '/account': 'nav.account',
    '/admins': 'nav.admins',
    '/audit': 'nav.audit',
    '/system': 'nav.system',
  }
  const key = map[activeMenu.value] || ''
  return key ? t(key) : ''
})

const roleLabel = computed(() =>
  t(`admins.role${role.value === 'admin' ? 'Admin' : role.value === 'operator' ? 'Operator' : 'Viewer'}`),
)

async function onLogout() {
  const ok = await confirm({
    title: t('nav.logout'),
    message: t('nav.logoutConfirm'),
  })
  if (!ok) return
  await doLogout()
  router.push('/login')
}
</script>
