<template>
  <div>
    <Card class="w-full max-w-xl">
      <CardContent>
        <h1 class="mb-3 text-xl font-bold">{{ t('orderDetail') }}</h1>
        <dl class="grid grid-cols-3 gap-2 text-sm">
          <dt class="text-muted-foreground">{{ t('orderNo') }}</dt>
          <dd class="col-span-2 font-mono">{{ order.order_no }}</dd>
          <dt class="text-muted-foreground">{{ t('product') }}</dt>
          <dd class="col-span-2">{{ order.product_name }} x{{ order.qty }}</dd>
          <dt class="text-muted-foreground">{{ t('amount') }}</dt>
          <dd class="col-span-2 font-semibold">{{ money(order.amount_cents) }} {{ order.fiat }}</dd>
          <dt class="text-muted-foreground">{{ t('tradeType') }}</dt>
          <dd class="col-span-2">{{ order.trade_type }}</dd>
          <dt class="text-muted-foreground">{{ t('paymentGateway') }}</dt>
          <dd class="col-span-2">{{ gatewayLabel(order) }}</dd>
          <dt class="text-muted-foreground">{{ t('status') }}</dt>
          <dd class="col-span-2">
            <span class="inline-flex items-center gap-1">
              {{ statusText(order.status) }}
              <span v-if="order.status === 'waiting_payment'" class="text-xs text-muted-foreground">{{
                t('autoRefresh')
              }}</span>
            </span>
          </dd>
          <dt class="text-muted-foreground">{{ t('createdAt') }}</dt>
          <dd class="col-span-2">{{ date(order.created_at) }}</dd>
          <template v-if="order.paid_at">
            <dt class="text-muted-foreground">{{ t('paidAt') }}</dt>
            <dd class="col-span-2">{{ date(order.paid_at) }}</dd>
          </template>
        </dl>
        <Alert v-if="order.status === 'pending_delivery'" class="mt-3">
          <Info class="h-4 w-4" />
          <AlertDescription>{{ t('pendingDeliveryHint') }}</AlertDescription>
        </Alert>
        <Alert v-if="errorMsg" variant="destructive" class="mt-3">
          <AlertDescription>{{ errorMsg }}</AlertDescription>
        </Alert>
        <Alert v-if="linkSent" class="mt-3">
          <AlertDescription>{{ t('linkSent') }}</AlertDescription>
        </Alert>
        <div v-if="!hasToken && contact" class="mt-3">
          <Button variant="outline" size="sm" :disabled="resending" @click="resendLink">
            <Loader2 v-if="resending" class="animate-spin" />
            {{ t('resendOrderLink') }}
          </Button>
        </div>
        <div v-if="order.status === 'waiting_payment' && order.payment_url" class="mt-4 flex gap-2">
          <Button as-child>
            <a :href="order.payment_url">{{ t('continuePay') }}</a>
          </Button>
          <Button variant="outline" class="text-destructive" @click="cancel">{{ t('cancelOrder') }}</Button>
        </div>
        <div v-if="order.delivery_type === 'manual' && order.delivery_content" class="mt-5">
          <h2 class="mb-2 font-bold">{{ t('deliveryInfo') }}</h2>
          <div class="whitespace-pre-wrap rounded-lg bg-muted p-4 font-mono">{{ order.delivery_content }}</div>
        </div>
        <div v-else-if="cards.length" class="mt-5">
          <h2 class="mb-2 font-bold">{{ t('cards') }}</h2>
          <ul class="space-y-1 rounded-lg bg-muted p-4 font-mono">
            <li v-for="c in cards" :key="c.id">{{ c.content }}</li>
          </ul>
          <p class="mt-2 text-xs text-muted-foreground">{{ t('cardsSaved') }}</p>
        </div>
      </CardContent>
    </Card>

    <Dialog :open="turnstileOpen" @update:open="turnstileOpen = $event">
      <DialogContent class="max-w-sm text-center">
        <DialogHeader>
          <DialogTitle>{{ t('verifyTitle') }}</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground">{{ t('verifyHint') }}</p>
        <div ref="turnstileContainer" class="mt-4 flex justify-center"></div>
        <p v-if="turnstileError" class="mt-2 text-sm text-destructive">{{ t('verifyRetry') }}</p>
        <Button variant="ghost" size="sm" class="mt-2" @click="closeTurnstile">
          {{ t('verifyCancel') }}
        </Button>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { Info, Loader2 } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getSite } from '@/features/catalog/api'
import { useOrderQuery } from '@/features/order-query/composables/useOrderQuery'

const route = useRoute()
const { t } = useI18n()
const { date: siteDate } = useSiteConfig()
const orderQuery = useOrderQuery()
const { data: siteData } = await useAsyncData('order-site-key', () => getSite().catch(() => null))
const { data } = await useAsyncData(() =>
  orderQuery.detail(String(route.params.orderNo), {
    contact: typeof route.query.contact === 'string' ? route.query.contact : undefined,
    token: typeof route.query.token === 'string' ? route.query.token : undefined,
  }),
)
const order = computed(() => (data.value as any)?.order || {})
const cards = computed(() => (data.value as any)?.cards || [])
const errorMsg = ref('')
const linkSent = ref(false)
const resending = ref(false)
const hasToken = computed(() => !!route.query.token)
const contact = computed(() => String(route.query.contact || ''))
const turnstileSiteKey = computed(() => (siteData.value as any)?.turnstile_site_key || '')
const turnstileOpen = ref(false)
const turnstileError = ref(false)
const turnstileWidget = ref<any>(null)
const turnstileContainer = ref<HTMLElement | null>(null)
let turnstilePending = false

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
  if (!turnstileSiteKey.value) return
  const poll = () => {
    if (window.turnstile && turnstileContainer.value) {
      if (turnstileWidget.value) {
        window.turnstile.reset(turnstileWidget.value)
        return
      }
      turnstileWidget.value = window.turnstile.render(turnstileContainer.value, {
        sitekey: turnstileSiteKey.value,
        action: 'order-link-resend',
        callback: (token: string) => {
          turnstileError.value = false
          closeTurnstile()
          if (turnstilePending) {
            turnstilePending = false
            doResendLink(token)
          }
        },
      })
    } else {
      setTimeout(poll, 200)
    }
  }
  poll()
}

function openTurnstile() {
  turnstileError.value = false
  turnstileOpen.value = true
  turnstilePending = true
  ensureTurnstileScript()
  nextTick(renderTurnstile)
}

function closeTurnstile() {
  turnstileOpen.value = false
  if (window.turnstile && turnstileWidget.value) {
    window.turnstile.remove(turnstileWidget.value)
    turnstileWidget.value = null
  }
}

function money(c: number) {
  return ((c || 0) / 100).toFixed(2)
}
function date(ts: number) {
  return siteDate(ts)
}
function statusText(status: string) {
  return (t(`orderStatus.${status}`) as string) || status
}
function gatewayLabel(o: any) {
  const name = o?.payment_gateway_name?.trim()
  if (name) return name
  return o?.payment_gateway === 'hashpay' ? t('gatewayHashpay') : t('gatewayBepusdt')
}
useHead({ title: t('orderDetail'), meta: [{ name: 'robots', content: 'noindex,nofollow' }] })

let timer: any = null
async function cancel() {
  if (!confirm(t('cancelConfirm'))) return
  try {
    const token = String(route.query.token || '')
    const contact = String(route.query.contact || '')
    const query = token ? 'token=' + encodeURIComponent(token) : 'contact=' + encodeURIComponent(contact)
    await orderQuery.cancel(String(route.params.orderNo), query)
    await refresh()
  } catch (e: any) {
    errorMsg.value = e?.data?.error || e?.message || t('cancelFail')
  }
}
async function refresh() {
  try {
    const res: any = await orderQuery.detail(String(route.params.orderNo), {
      contact: typeof route.query.contact === 'string' ? route.query.contact : undefined,
      token: typeof route.query.token === 'string' ? route.query.token : undefined,
    })
    data.value = res
  } catch {
    // 忽略轮询错误，稍后重试
  }
  if (data.value?.order?.status === 'waiting_payment') {
    timer = setTimeout(refresh, 3000)
  }
}

async function resendLink() {
  if (turnstileSiteKey.value) {
    openTurnstile()
    return
  }
  await doResendLink('')
}

async function doResendLink(token: string) {
  resending.value = true
  linkSent.value = false
  errorMsg.value = ''
  try {
    await orderQuery.sendOne(contact.value, String(route.params.orderNo), token)
    linkSent.value = true
  } catch (e: any) {
    errorMsg.value = e?.data?.error || e?.message || t('linkFail')
  } finally {
    resending.value = false
  }
}
onMounted(() => {
  if (order.value.status === 'waiting_payment') {
    timer = setTimeout(refresh, 3000)
  }
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  if (window.turnstile && turnstileWidget.value) {
    window.turnstile.remove(turnstileWidget.value)
    turnstileWidget.value = null
  }
})
</script>
