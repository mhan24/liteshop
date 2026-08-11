<template>
  <div>
    <div v-if="loading" class="flex justify-center py-24">
      <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
    </div>

    <template v-else>
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent class="!py-5">
            <div class="text-sm text-muted-foreground">{{ t('dashboard.todayOrders') }}</div>
            <div class="mt-1 text-3xl font-bold">{{ stats.today_orders || 0 }}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="!py-5">
            <div class="text-sm text-muted-foreground">{{ t('dashboard.todayRevenue') }}</div>
            <div class="mt-1 text-3xl font-bold">{{ revenue }}</div>
            <div class="text-xs text-muted-foreground">{{ currencyLabel }}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="!py-5">
            <div class="text-sm text-muted-foreground">{{ t('dashboard.todaySales') }}</div>
            <div class="mt-1 text-3xl font-bold">{{ stats.today_sales || 0 }}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="!py-5">
            <div class="text-sm text-muted-foreground">{{ t('dashboard.todayCards') }}</div>
            <div class="mt-1 text-3xl font-bold">{{ stats.today_paid_cards || 0 }}</div>
          </CardContent>
        </Card>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card class="cursor-pointer transition hover:ring-2 hover:ring-ring" @click="$router.push('/orders')">
          <CardContent class="flex items-center gap-4 !py-5">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
              <Clock class="h-6 w-6" />
            </div>
            <div>
              <div class="text-sm text-muted-foreground">{{ t('dashboard.pendingOrders') }}</div>
              <div class="text-2xl font-bold">{{ stats.pending_orders || 0 }}</div>
            </div>
          </CardContent>
        </Card>
        <Card
          class="cursor-pointer transition hover:ring-2 hover:ring-ring"
          @click="$router.push('/orders?status=payment_failed')"
        >
          <CardContent class="flex items-center gap-4 !py-5">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-600">
              <TriangleAlert class="h-6 w-6" />
            </div>
            <div>
              <div class="text-sm text-muted-foreground">{{ t('dashboard.paymentFailed') }}</div>
              <div class="text-2xl font-bold">{{ stats.payment_failed || 0 }}</div>
            </div>
          </CardContent>
        </Card>
        <Card
          class="cursor-pointer transition hover:ring-2 hover:ring-ring"
          @click="$router.push('/orders?status=delivery_failed')"
        >
          <CardContent class="flex items-center gap-4 !py-5">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-600">
              <XCircle class="h-6 w-6" />
            </div>
            <div>
              <div class="text-sm text-muted-foreground">{{ t('dashboard.deliveryFailed') }}</div>
              <div class="text-2xl font-bold">{{ stats.delivery_failed || 0 }}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader class="flex-row items-center justify-between">
            <CardTitle class="text-base">{{ t('dashboard.lowStock') }}</CardTitle>
            <Badge variant="destructive">{{ stats.low_stock?.length || 0 }}</Badge>
          </CardHeader>
          <CardContent>
            <DataTable :columns="lowStockColumns" :rows="stats.low_stock || []" :empty-text="t('dashboard.noLowStock')">
              <template #stock="{ row }">
                <Badge :class="row.available === 0 ? 'bg-red-500/15 text-red-700' : 'bg-amber-500/15 text-amber-700'">
                  {{ row.available }}
                </Badge>
              </template>
              <template #price="{ row }">{{ fmtMoney(row.price_cents) }}</template>
              <template #action="{ row }">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2"
                  @click="$router.push('/products/' + row.id + '/cards')"
                >
                  {{ t('common.edit') }}
                </Button>
              </template>
            </DataTable>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="text-base">{{ t('dashboard.systemStatus') }}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl class="divide-y text-sm">
              <div class="flex items-center justify-between py-2.5">
                <dt class="text-muted-foreground">{{ t('dashboard.goVersion') }}</dt>
                <dd class="font-medium">{{ stats.system?.go_version || '-' }}</dd>
              </div>
              <div class="flex items-center justify-between py-2.5">
                <dt class="text-muted-foreground">{{ t('dashboard.uptime') }}</dt>
                <dd class="font-medium">{{ uptimeText }}</dd>
              </div>
              <div class="flex items-center justify-between py-2.5">
                <dt class="text-muted-foreground">{{ t('dashboard.dbSize') }}</dt>
                <dd class="font-medium">{{ dbSizeText }}</dd>
              </div>
              <div class="flex items-center justify-between py-2.5">
                <dt class="text-muted-foreground">{{ t('dashboard.products') }}</dt>
                <dd class="font-medium">{{ stats.products || 0 }}</dd>
              </div>
              <div class="flex items-center justify-between py-2.5">
                <dt class="text-muted-foreground">{{ t('dashboard.cardStock') }}</dt>
                <dd class="flex flex-wrap items-center gap-1.5">
                  <Badge class="bg-emerald-500/15 text-emerald-700"
                    >{{ t('cards.status.available') }}: {{ stats.available_cards || 0 }}</Badge
                  >
                  <Badge class="bg-amber-500/15 text-amber-700"
                    >{{ t('cards.status.locked') }}: {{ stats.locked_cards || 0 }}</Badge
                  >
                  <Badge variant="secondary">{{ t('cards.status.sold') }}: {{ stats.sold_cards || 0 }}</Badge>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle class="text-base">{{ t('dashboard.salesTrend') }}</CardTitle>
          </CardHeader>
          <CardContent><div ref="trendChart" class="h-[260px] w-full"></div></CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle class="text-base">{{ t('dashboard.productShare') }}</CardTitle>
          </CardHeader>
          <CardContent><div ref="shareChart" class="h-[260px] w-full"></div></CardContent>
        </Card>
      </div>

      <Card class="mt-4">
        <CardHeader>
          <CardTitle class="text-base">{{ t('dashboard.recentOrders') }}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable :columns="recentColumns" :rows="stats.recent_orders || []">
            <template #status="{ row }">
              <Badge :class="statusBadgeClass(row.status)">{{ statusText(row.status) }}</Badge>
            </template>
            <template #amount="{ row }">{{ row.amount }} {{ row.fiat }}</template>
            <template #createdAt="{ row }">{{ date(row.created_at) }}</template>
          </DataTable>
        </CardContent>
      </Card>
    </template>
  </div>
</template>

<script setup lang="ts">
import * as echarts from 'echarts'
import { ref, computed, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock, Loader2, TriangleAlert, XCircle } from '@lucide/vue'
import { api } from '@/api'
import { fmtMoney, fmtDate, currencyLabel as getCurrencyLabel } from '@/utils/format'
import { statusBadgeClass } from '@/utils/status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import DataTable, { type DataColumn } from '@/components/DataTable.vue'

const { t } = useI18n()
const loading = ref(false)
const stats = ref<any>({})

const revenue = computed(() => ((stats.value.today_revenue || 0) / 100).toFixed(2))
const currencyLabel = computed(() => getCurrencyLabel())
const uptimeText = computed(() => {
  const s = stats.value.system?.uptime || 0
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
})
const dbSizeText = computed(() => {
  const b = stats.value.system?.db_size || 0
  if (b > 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB'
  if (b > 1024) return (b / 1024).toFixed(1) + ' KB'
  return b + ' B'
})

const lowStockColumns = computed<DataColumn[]>(() => [
  { key: 'name', label: t('common.name') },
  { slot: 'stock', label: t('products.stock'), width: '90px', align: 'center' },
  { slot: 'price', label: t('common.price'), width: '110px', align: 'right' },
  { slot: 'action', label: '', width: '80px', align: 'right' },
])

const recentColumns = computed<DataColumn[]>(() => [
  { key: 'order_no', label: t('orders.orderNo'), width: '220px' },
  { key: 'product_name', label: t('orders.product') },
  { slot: 'amount', label: t('orders.amount'), width: '110px', align: 'right' },
  { slot: 'status', label: t('common.status'), width: '110px' },
  { slot: 'createdAt', label: t('orders.createdAt'), width: '170px' },
])

function statusText(status: string) {
  return (t(`orders.status.${status}`) as string) || status
}
function date(ts: number) {
  return fmtDate(ts)
}

const trendChart = ref<HTMLElement | null>(null)
const shareChart = ref<HTMLElement | null>(null)

async function loadCharts() {
  if (!trendChart.value || !shareChart.value) return
  const report: any = await api.get('/admin/sales-report?days=14').catch(() => null)
  if (!report) return
  const daily = report.daily || []
  const trend = echarts.init(trendChart.value)
  trend.setOption({
    grid: { left: 50, right: 20, top: 30, bottom: 30 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: daily.map((d: any) => d.Date) },
    yAxis: { type: 'value' },
    series: [
      {
        name: t('dashboard.todayRevenue'),
        type: 'line',
        smooth: true,
        areaStyle: { opacity: 0.15 },
        data: daily.map((d: any) => (d.Revenue / 100).toFixed(2)),
      },
    ],
  })
  const products = report.products || []
  const share = echarts.init(shareChart.value)
  share.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    series: [{ type: 'pie', radius: ['35%', '65%'], data: products.map((p: any) => ({ name: p.Name, value: p.Qty })) }],
  })
}

onMounted(async () => {
  loading.value = true
  try {
    stats.value = await api.get('/admin/dashboard')
  } finally {
    loading.value = false
  }
  await nextTick()
  loadCharts()
})
</script>
