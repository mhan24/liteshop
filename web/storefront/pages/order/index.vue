<template>
  <Card class="w-full max-w-xl">
    <CardContent>
      <h1 class="text-xl font-bold">{{ t('orderQuery') }}</h1>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('forgotOrderNo') }}</p>
      <Alert v-if="errorMsg" variant="destructive" class="mt-3">
        <AlertDescription>{{ errorMsg }}</AlertDescription>
      </Alert>
      <Alert v-if="successMsg" class="mt-3">
        <AlertDescription>{{ successMsg }}</AlertDescription>
      </Alert>
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

      <div v-if="orders.length" class="mt-5">
        <div class="mb-2 flex items-center justify-between gap-2">
          <label class="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox :model-value="allSelected" @update:model-value="toggleAll($event === true)" />
            {{ t('selectAll') }}
          </label>
          <span v-if="selected.length" class="text-xs text-muted-foreground">
            {{ selectedLabel }}
          </span>
        </div>
        <div class="divide-y">
          <div
            v-for="item in orders"
            :key="item.order_no"
            class="flex flex-wrap items-center justify-between gap-2 py-3"
          >
            <div class="flex min-w-0 items-start gap-2">
              <Checkbox
                :model-value="selected.includes(item.order_no)"
                :disabled="!linkable(item.status)"
                class="mt-1"
                @update:model-value="toggleSelect(item.order_no, $event === true)"
              />
              <div class="min-w-0">
                <div class="font-semibold">{{ item.product_name }} x{{ item.qty }}</div>
                <div class="text-sm text-muted-foreground">
                  <span>{{ orderSub(item) }} · {{ date(item.paid_at || item.created_at) }}</span>
                </div>
                <Badge :class="badgeClass(item.status)">{{ statusText(item.status) }}</Badge>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <Button as-child v-if="item.payment_url" variant="link" class="px-0 font-semibold">
                <a :href="item.payment_url">{{ t('continuePay') }}</a>
              </Button>
              <Button v-if="linkable(item.status)" variant="outline" size="sm" @click="sendOne(item)">
                {{ t('sendLink') }}
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div v-if="searched && orders.length" class="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" :disabled="!selected.length" @click="sendSelected">
          {{ t('sendSelected') }} ({{ selected.length }})
        </Button>
        <Button variant="link" class="px-0" @click="sendAllLinks">{{ t('sendAllLinks') }}</Button>
      </div>
      <div ref="turnstileContainer" v-if="turnstilePending" class="mt-3"></div>
      <p v-else-if="searched && !loading" class="mt-5 text-muted-foreground">{{ t('noOrders') }}</p>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Loader2 } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { getSite } from '@/features/catalog/api'
import { useOrderQuery } from '@/features/order-query/composables/useOrderQuery'

const { t } = useI18n()
const { date: siteDate } = useSiteConfig()
const orderQuery = useOrderQuery()
const form = reactive({ contact: '', order_no: '' })
const orders = ref<any[]>([])
const loading = ref(false)
const searched = ref(false)
const errorMsg = ref('')
const successMsg = ref('')
const selected = ref<string[]>([])
const turnstileSiteKey = ref('')
const turnstileWidget = ref<any>(null)
const turnstileContainer = ref<HTMLElement | null>(null)
const turnstilePending = ref(false)
const pendingAction = ref<'lookup' | 'all' | 'selected' | 'single'>('lookup')
const pendingOrderNo = ref('')

const { data: site } = await useAsyncData('order-site', () => getSite().catch(() => null))
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
          switch (pendingAction.value) {
            case 'all':
              doSendLinks(token, [])
              break
            case 'selected':
              doSendLinks(token, [...selected.value])
              break
            case 'single':
              doSendLinks(token, [pendingOrderNo.value])
              break
            default:
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
  errorMsg.value = ''
  successMsg.value = ''
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
  selected.value = []
  try {
    const data: any = await orderQuery.lookup(form.contact, token)
    orders.value = data.orders || []
    selected.value = []
  } catch (e: any) {
    errorMsg.value = e?.data?.error || e?.message || t('queryFail')
  } finally {
    loading.value = false
  }
}
async function sendAllLinks() {
  if (turnstileSiteKey.value) {
    pendingAction.value = 'all'
    turnstilePending.value = true
    ensureTurnstileScript()
    await nextTick()
    renderTurnstile()
    return
  }
  await doSendLinks('', [])
}

async function sendSelected() {
  const nos = [...selected.value]
  if (!nos.length) return
  if (turnstileSiteKey.value) {
    pendingAction.value = 'selected'
    turnstilePending.value = true
    ensureTurnstileScript()
    await nextTick()
    renderTurnstile()
    return
  }
  await doSendLinks('', nos)
}

async function sendOne(item: any) {
  pendingOrderNo.value = item.order_no
  if (turnstileSiteKey.value) {
    pendingAction.value = 'single'
    turnstilePending.value = true
    ensureTurnstileScript()
    await nextTick()
    renderTurnstile()
    return
  }
  await doSendLinks('', [item.order_no])
}

async function doSendLinks(token: string, orderNos: string[]) {
  try {
    const res: any = orderNos.length
      ? await orderQuery.sendSelected(form.contact, orderNos, token)
      : await orderQuery.sendAll(form.contact, token)
    successMsg.value = res?.sent ? t('linkSent') : t('noValidOrders')
  } catch (e: any) {
    errorMsg.value = e?.data?.error || e?.message || t('linkFail')
  }
}
function linkable(status: string) {
  return [
    'created',
    'waiting_payment',
    'paid',
    'processing',
    'pending_delivery',
    'delivered',
    'completed',
    'delivery_failed',
  ].includes(status)
}
const linkableOrders = computed(() => orders.value.filter((o) => linkable(o.status)))
const allSelected = computed(
  () => linkableOrders.value.length > 0 && linkableOrders.value.every((o) => selected.value.includes(o.order_no)),
)
const selectedLabel = computed(() => t('selectedCount').replace('{n}', String(selected.value.length)))
function toggleAll(v: boolean) {
  if (v) {
    const set = new Set(selected.value)
    for (const o of linkableOrders.value) set.add(o.order_no)
    selected.value = [...set]
  } else {
    const set = new Set(linkableOrders.value.map((o) => o.order_no))
    selected.value = selected.value.filter((n) => !set.has(n))
  }
}
function toggleSelect(orderNo: string, v: boolean) {
  const idx = selected.value.indexOf(orderNo)
  if (v && idx < 0) selected.value.push(orderNo)
  if (!v && idx >= 0) selected.value.splice(idx, 1)
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
    paid: 'bg-emerald-500/15 text-emerald-700',
    processing: 'bg-emerald-500/15 text-emerald-700',
    delivered: 'bg-emerald-500/15 text-emerald-700',
    completed: 'bg-emerald-500/15 text-emerald-700',
    waiting_payment: 'bg-amber-500/15 text-amber-700',
    created: 'bg-muted text-muted-foreground',
    expired: 'bg-red-500/15 text-red-700',
    payment_failed: 'bg-red-500/15 text-red-700',
    delivery_failed: 'bg-red-500/15 text-red-700',
    cancelled: 'bg-muted text-muted-foreground',
  }
  return m[status] || 'bg-muted text-muted-foreground'
}
useHead({
  title: t('orderQuery'),
  meta: [
    { name: 'description', content: t('orderQueryDesc') },
    { name: 'robots', content: 'noindex,nofollow' },
  ],
})
</script>
