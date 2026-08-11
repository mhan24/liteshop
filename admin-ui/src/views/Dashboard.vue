<template>
  <div>
    <div v-if="loading" class="flex justify-center py-24">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>

    <template v-else>
      <!-- 今日指标 -->
      <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
          <div class="card-body !p-5">
            <div class="text-sm opacity-60">{{ t('dashboard.todayOrders') }}</div>
            <div class="mt-1 text-3xl font-bold">{{ stats.today_orders || 0 }}</div>
          </div>
        </div>
        <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
          <div class="card-body !p-5">
            <div class="text-sm opacity-60">{{ t('dashboard.todayRevenue') }}</div>
            <div class="mt-1 text-3xl font-bold">{{ revenue }}</div>
            <div class="text-xs opacity-60">{{ currencyLabel }}</div>
          </div>
        </div>
        <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
          <div class="card-body !p-5">
            <div class="text-sm opacity-60">{{ t('dashboard.todaySales') }}</div>
            <div class="mt-1 text-3xl font-bold">{{ stats.today_sales || 0 }}</div>
          </div>
        </div>
        <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
          <div class="card-body !p-5">
            <div class="text-sm opacity-60">{{ t('dashboard.todayCards') }}</div>
            <div class="mt-1 text-3xl font-bold">{{ stats.today_paid_cards || 0 }}</div>
          </div>
        </div>
      </div>

      <!-- 待处理告警 -->
      <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div class="card cursor-pointer bg-base-100 shadow-sm ring-1 ring-base-300 transition hover:ring-2 hover:ring-primary/50" @click="$router.push('/orders')">
          <div class="card-body flex-row items-center gap-4 !py-5">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
              <Clock class="h-6 w-6" />
            </div>
            <div>
              <div class="text-sm opacity-60">{{ t('dashboard.pendingOrders') }}</div>
              <div class="text-2xl font-bold">{{ stats.pending_orders || 0 }}</div>
            </div>
          </div>
        </div>
        <div class="card cursor-pointer bg-base-100 shadow-sm ring-1 ring-base-300 transition hover:ring-2 hover:ring-error/50" @click="$router.push('/orders?status=payment_failed')">
          <div class="card-body flex-row items-center gap-4 !py-5">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-error/15 text-error">
              <TriangleAlert class="h-6 w-6" />
            </div>
            <div>
              <div class="text-sm opacity-60">{{ t('dashboard.paymentFailed') }}</div>
              <div class="text-2xl font-bold">{{ stats.payment_failed || 0 }}</div>
            </div>
          </div>
        </div>
        <div class="card cursor-pointer bg-base-100 shadow-sm ring-1 ring-base-300 transition hover:ring-2 hover:ring-error/50" @click="$router.push('/orders?status=delivery_failed')">
          <div class="card-body flex-row items-center gap-4 !py-5">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-error/15 text-error">
              <XCircle class="h-6 w-6" />
            </div>
            <div>
              <div class="text-sm opacity-60">{{ t('dashboard.deliveryFailed') }}</div>
              <div class="text-2xl font-bold">{{ stats.delivery_failed || 0 }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <!-- 库存不足 -->
        <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
          <div class="card-body !pb-2">
            <div class="flex items-center justify-between">
              <h3 class="font-semibold">{{ t('dashboard.lowStock') }}</h3>
              <span class="badge badge-error badge-sm">{{ stats.low_stock?.length || 0 }}</span>
            </div>
          </div>
          <div class="card-body !pt-2">
            <DataTable
              :columns="lowStockColumns"
              :rows="stats.low_stock || []"
              :empty-text="t('dashboard.noLowStock')"
            >
              <template #stock="{ row }">
                <span class="badge" :class="row.available === 0 ? 'badge-error' : 'badge-warning'">
                  {{ row.available }}
                </span>
              </template>
              <template #price="{ row }">{{ fmtMoney(row.price_cents) }}</template>
              <template #action="{ row }">
                <button class="btn btn-ghost btn-xs" @click="$router.push('/products/' + row.id + '/cards')">
                  {{ t('common.edit') }}
                </button>
              </template>
            </DataTable>
          </div>
        </div>

        <!-- 系统状态 -->
        <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
          <div class="card-body !pb-2">
            <h3 class="font-semibold">{{ t('dashboard.systemStatus') }}</h3>
          </div>
          <div class="card-body !pt-2">
            <dl class="divide-y divide-base-200 text-sm">
              <div class="flex items-center justify-between py-2.5">
                <dt class="opacity-60">{{ t('dashboard.goVersion') }}</dt>
                <dd class="font-medium">{{ stats.system?.go_version || '-' }}</dd>
              </div>
              <div class="flex items-center justify-between py-2.5">
                <dt class="opacity-60">{{ t('dashboard.uptime') }}</dt>
                <dd class="font-medium">{{ uptimeText }}</dd>
              </div>
              <div class="flex items-center justify-between py-2.5">
                <dt class="opacity-60">{{ t('dashboard.dbSize') }}</dt>
                <dd class="font-medium">{{ dbSizeText }}</dd>
              </div>
              <div class="flex items-center justify-between py-2.5">
                <dt class="opacity-60">{{ t('dashboard.products') }}</dt>
                <dd class="font-medium">{{ stats.products || 0 }}</dd>
              </div>
              <div class="flex items-center justify-between py-2.5">
                <dt class="opacity-60">{{ t('dashboard.cardStock') }}</dt>
                <dd class="flex items-center gap-1.5">
                  <span class="badge badge-success badge-sm">{{ t('cards.status.available') }}: {{ stats.available_cards || 0 }}</span>
                  <span class="badge badge-warning badge-sm">{{ t('cards.status.locked') }}: {{ stats.locked_cards || 0 }}</span>
                  <span class="badge badge-ghost badge-sm">{{ t('cards.status.sold') }}: {{ stats.sold_cards || 0 }}</span>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <!-- 销售报表 -->
      <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
          <div class="card-body !pb-2">
            <h3 class="font-semibold">{{ t('dashboard.salesTrend') }}</h3>
          </div>
          <div class="card-body"><div ref="trendChart" class="h-[260px] w-full"></div></div>
        </div>
        <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
          <div class="card-body !pb-2">
            <h3 class="font-semibold">{{ t('dashboard.productShare') }}</h3>
          </div>
          <div class="card-body"><div ref="shareChart" class="h-[260px] w-full"></div></div>
        </div>
      </div>

      <!-- 最近交易 -->
      <div class="card mt-4 bg-base-100 shadow-sm ring-1 ring-base-300">
        <div class="card-body !pb-2">
          <h3 class="font-semibold">{{ t('dashboard.recentOrders') }}</h3>
        </div>
        <div class="card-body !pt-2">
          <DataTable :columns="recentColumns" :rows="stats.recent_orders || []">
            <template #status="{ row }">
              <span class="badge badge-sm" :class="statusBadgeClass(row.status)">{{ statusText(row.status) }}</span>
            </template>
            <template #amount="{ row }">{{ row.amount }} {{ row.fiat }}</template>
            <template #createdAt="{ row }">{{ date(row.created_at) }}</template>
          </DataTable>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import * as echarts from 'echarts'
import { ref, computed, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock, TriangleAlert, XCircle } from '@lucide/vue'
import { api } from '@/api'
import { fmtMoney, fmtDate, currencyLabel as getCurrencyLabel } from '@/utils/format'
import { statusBadgeClass } from '@/utils/status'
import DataTable, { type DataColumn } from '@/components/ui/DataTable.vue'

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
