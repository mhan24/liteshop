<template>
  <Card class="w-full max-w-xl">
    <CardContent>
      <h1 class="text-xl font-bold">{{ t('orderQuery') }}</h1>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('forgotOrderNo') }}</p>
      <form class="mt-4 grid gap-3" @submit.prevent="submit">
        <div>
          <label class="text-sm font-semibold">{{ t('email') }}</label>
          <Input v-model="form.contact" type="email" required class="mt-1" />
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('orderNoOptional') }}</label>
          <Input v-model="form.order_no" :placeholder="t('orderNoOptionalHint')" class="mt-1" />
        </div>
        <Button type="submit" :disabled="loading" class="w-fit">
          <Loader2 v-if="loading" class="animate-spin" />
          {{ form.order_no ? t('queryOrder') : t('recoverByEmail') }}
        </Button>
      </form>
      <p class="mt-2 text-xs text-muted-foreground">{{ t('orderLinkHint') }}</p>

      <div v-if="orders.length" class="mt-5 divide-y">
        <div v-for="(item, idx) in orders" :key="idx" class="flex flex-wrap items-center justify-between gap-2 py-3">
          <div>
            <div class="font-semibold">{{ item.product_name }} x{{ item.qty }}</div>
            <div class="text-sm text-muted-foreground">
              <span>{{ orderSub(item) }} · {{ date(item.paid_at || item.created_at) }}</span>
            </div>
            <Badge :class="badgeClass(item.status)">{{ statusText(item.status) }}</Badge>
          </div>
          <div class="flex gap-2">
            <Button as-child v-if="item.payment_url" variant="link" class="px-0 font-semibold">
              <a :href="item.payment_url">{{ t('continuePay') }}</a>
            </Button>
          </div>
        </div>
      </div>
      <div v-if="searched" class="mt-4">
        <Button variant="link" class="px-0" @click="sendAllLinks">{{ t('sendAllLinks') }}</Button>
      </div>
      <div ref="turnstileContainer" v-if="turnstilePending" class="mt-3"></div>
      <p v-else-if="searched && !loading" class="mt-5 text-muted-foreground">{{ t('noOrders') }}</p>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Loader2 } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const { t } = useI18n()
const { date: siteDate } = useSiteConfig()
const api = useApi()
const form = reactive({ contact: '', order_no: '' })
const orders = ref<any[]>([])
const loading = ref(false)
const searched = ref(false)
const turnstileSiteKey = ref('')
const turnstileWidget = ref<any>(null)
const turnstileContainer = ref<HTMLElement | null>(null)
const turnstilePending = ref(false)
const pendingAction = ref<'lookup' | 'links'>('lookup')

const { data: site } = await useAsyncData('order-site', () => api.get('/site').catch(() => null))
turnstileSiteKey.value = (site.value as any)?.turnstile_site_key || ''

function ensureTurnstileScript() {
  if (!turnstileSiteKey.value) return
  if (!document.getElementById('turnstile-api')) {
    const s = document.createElement('script')
    s.id = 'turnstile-api'
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    s.async = true
    s.defer = true
    document.head.appendChild(s)
  }
}

function renderTurnstile() {
  const poll = () => {
    if (window.turnstile && turnstileContainer.value) {
      turnstileWidget.value = window.turnstile.render(turnstileContainer.value, {
        sitekey: turnstileSiteKey.value,
        action: 'order-lookup',
        callback: (token: string) => {
          turnstilePending.value = false
          if (pendingAction.value === 'links') {
            doSendAllLinks(token)
          } else {
            doLookup(token)
          }
        },
      })
    } else {
      setTimeout(poll, 200)
    }
  }
  poll()
}

async function submit() {
  if (!form.contact) return
  if (turnstileSiteKey.value) {
    pendingAction.value = 'lookup'
    turnstilePending.value = true
    ensureTurnstileScript()
    await nextTick()
    renderTurnstile()
    return
  }
  await doLookup('')
}

async function doLookup(token: string) {
  if (form.order_no) {
    await navigateTo({ path: `/order/${form.order_no}`, query: { contact: form.contact } })
    return
  }
  loading.value = true
  searched.value = true
  orders.value = []
  try {
    const data: any = await api.get('/orders', {
      contact: form.contact,
    }, token ? { 'X-Turnstile-Response': token } : undefined)
    orders.value = data.orders || []
  } catch (e: any) {
    alert(e?.data?.error || e?.message || t('queryFail'))
  } finally {
    loading.value = false
  }
}
async function sendAllLinks() {
  if (turnstileSiteKey.value) {
    pendingAction.value = 'links'
    turnstilePending.value = true
    ensureTurnstileScript()
    await nextTick()
    renderTurnstile()
    return
  }
  await doSendAllLinks('')
}

async function doSendAllLinks(token: string) {
  try {
    await api.post('/orders/links', { contact: form.contact }, token ? { 'X-Turnstile-Response': token } : undefined)
    alert(t('linkSent'))
  } catch (e: any) {
    alert(e?.data?.error || e?.message || t('linkFail'))
  }
}
function orderSub(item: any) {
  return ['paid', 'processing', 'delivered', 'completed'].includes(item.status)
    ? t('paidOrderSent')
    : t('orderSubPending')
}
function date(ts: number) {
  return siteDate(ts)
}
function statusText(status: string) {
  return (t(`orderStatus.${status}`) as string) || status
}
function badgeClass(status: string) {
  const m: any = {
    paid: 'bg-emerald-500/15 text-emerald-700', processing: 'bg-emerald-500/15 text-emerald-700',
    delivered: 'bg-emerald-500/15 text-emerald-700', completed: 'bg-emerald-500/15 text-emerald-700',
    waiting_payment: 'bg-amber-500/15 text-amber-700', created: 'bg-muted text-muted-foreground',
    expired: 'bg-red-500/15 text-red-700', payment_failed: 'bg-red-500/15 text-red-700',
    delivery_failed: 'bg-red-500/15 text-red-700', cancelled: 'bg-muted text-muted-foreground',
  }
  return m[status] || 'bg-muted text-muted-foreground'
}
useHead({ title: t('orderQuery'), meta: [{ name: 'description', content: t('orderQueryDesc') }, { name: 'robots', content: 'noindex,nofollow' }] })
</script>
