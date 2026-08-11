<template>
  <div class="flex h-full flex-col">
    <div class="flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Store class="h-5 w-5" />
      </div>
      <span v-show="!collapsed" class="truncate text-base font-semibold">{{ t('app.title') }}</span>
    </div>

    <nav class="flex-1 space-y-1 overflow-y-auto p-3">
      <template v-for="group in groups" :key="group.label">
        <p
          v-if="group.label && !collapsed"
          class="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wider text-muted-foreground"
        >
          {{ t(group.label) }}
        </p>
        <Button
          v-for="item in group.items"
          :key="item.to"
          as-child
          :variant="activeMenu === item.to ? 'secondary' : 'ghost'"
          :class="activeMenu === item.to ? '' : 'text-muted-foreground'"
          class="w-full justify-start gap-3"
        >
          <RouterLink :to="item.to" class="flex w-full items-center gap-3">
            <component :is="item.icon" class="h-5 w-5 shrink-0" />
            <span v-show="!collapsed" class="truncate">{{ t(item.label) }}</span>
          </RouterLink>
        </Button>
      </template>
    </nav>

    <div class="shrink-0 space-y-1 border-t p-3">
      <Button as-child variant="ghost" class="w-full justify-start gap-3 text-muted-foreground">
        <a href="/" target="_blank" rel="noopener" class="flex w-full items-center gap-3">
          <ExternalLink class="h-5 w-5 shrink-0" />
          <span v-show="!collapsed">{{ t('nav.front') }}</span>
        </a>
      </Button>
      <Button variant="ghost" class="w-full justify-start gap-3 text-muted-foreground" @click="emit('logout')">
        <LogOut class="h-5 w-5 shrink-0" />
        <span v-show="!collapsed">{{ t('nav.logout') }}</span>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ExternalLink,
  Home,
  ListOrdered,
  LogOut,
  Package,
  ScrollText,
  Settings,
  Store,
  Ticket,
  User,
  Users,
  Wallet,
  Wrench,
  Bell,
} from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { useSession } from '@/hooks/useSession'

defineProps<{
  collapsed: boolean
  activeMenu: string
}>()

const emit = defineEmits<{ logout: [] }>()

const { t } = useI18n()
const { isAdmin } = useSession()

const groups = computed(() => [
  {
    label: '',
    items: [
      { to: '/', label: 'nav.home', icon: Home },
      { to: '/products', label: 'nav.products', icon: Package },
      { to: '/orders', label: 'nav.orders', icon: ListOrdered },
      { to: '/coupons', label: 'nav.coupons', icon: Ticket },
      { to: '/settings', label: 'nav.payment', icon: Wallet },
    ],
  },
  {
    label: 'nav.manage',
    items: [
      { to: '/notify', label: 'nav.notify', icon: Bell },
      { to: '/site', label: 'nav.site', icon: Settings },
      { to: '/account', label: 'nav.account', icon: User },
      ...(isAdmin.value
        ? [
            { to: '/admins', label: 'nav.admins', icon: Users },
            { to: '/audit', label: 'nav.audit', icon: ScrollText },
          ]
        : []),
      { to: '/system', label: 'nav.system', icon: Wrench },
    ],
  },
])
</script>
