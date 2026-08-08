<template>
  <div v-loading="loading">
    <!-- 今日指标 -->
    <el-row :gutter="16">
      <el-col :xs="12" :md="6">
        <el-card shadow="hover">
          <el-statistic :title="t('dashboard.todayOrders')" :value="stats.today_orders || 0" />
        </el-card>
      </el-col>
      <el-col :xs="12" :md="6">
        <el-card shadow="hover">
          <el-statistic :title="t('dashboard.todayRevenue')" :value="revenue" :precision="2" />
          <div class="stat-sub">{{ currencyLabel }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :md="6">
        <el-card shadow="hover">
          <el-statistic :title="t('dashboard.todaySales')" :value="stats.today_sales || 0" />
        </el-card>
      </el-col>
      <el-col :xs="12" :md="6">
        <el-card shadow="hover">
          <el-statistic :title="t('dashboard.todayCards')" :value="stats.today_paid_cards || 0" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 待处理告警 -->
    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :xs="12" :md="8">
        <el-card shadow="hover" @click="$router.push('/orders')">
          <div class="alert-row">
            <div class="alert-icon warn">
              <el-icon><Clock /></el-icon>
            </div>
            <div>
              <div class="alert-title">{{ t('dashboard.pendingOrders') }}</div>
              <div class="alert-value">{{ stats.pending_orders || 0 }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="12" :md="8">
        <el-card shadow="hover" @click="$router.push('/orders?status=payment_failed')">
          <div class="alert-row">
            <div class="alert-icon danger">
              <el-icon><Warning /></el-icon>
            </div>
            <div>
              <div class="alert-title">{{ t('dashboard.paymentFailed') }}</div>
              <div class="alert-value">{{ stats.payment_failed || 0 }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="12" :md="8">
        <el-card shadow="hover" @click="$router.push('/orders?status=delivery_failed')">
          <div class="alert-row">
            <div class="alert-icon danger">
              <el-icon><Failed /></el-icon>
            </div>
            <div>
              <div class="alert-title">{{ t('dashboard.deliveryFailed') }}</div>
              <div class="alert-value">{{ stats.delivery_failed || 0 }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <!-- 库存不足 -->
      <el-col :md="12">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>{{ t('dashboard.lowStock') }}</span>
              <el-badge :value="stats.low_stock?.length || 0" type="danger" />
            </div>
          </template>
          <el-table :data="stats.low_stock || []" size="small">
            <el-table-column prop="name" :label="t('common.name')" />
            <el-table-column :label="t('products.stock')" width="90">
              <template #default="{ row }">
                <el-tag :type="row.available === 0 ? 'danger' : 'warning'" size="small">{{ row.available }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="t('common.price')" width="100">
              <template #default="{ row }">{{ fmtMoney(row.price_cents) }}</template>
            </el-table-column>
            <el-table-column label="" width="80">
              <template #default="{ row }">
                <el-button size="small" @click="$router.push('/products/' + row.id + '/cards')">{{
                  t('common.edit')
                }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="!(stats.low_stock || []).length" class="empty-tip">{{ t('dashboard.noLowStock') }}</div>
        </el-card>
      </el-col>

      <!-- 系统状态 -->
      <el-col :md="12">
        <el-card>
          <template #header
            ><span>{{ t('dashboard.systemStatus') }}</span></template
          >
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item :label="t('dashboard.goVersion')">{{
              stats.system?.go_version
            }}</el-descriptions-item>
            <el-descriptions-item :label="t('dashboard.uptime')">{{ uptimeText }}</el-descriptions-item>
            <el-descriptions-item :label="t('dashboard.dbSize')">{{ dbSizeText }}</el-descriptions-item>
            <el-descriptions-item :label="t('dashboard.products')">{{ stats.products || 0 }}</el-descriptions-item>
            <el-descriptions-item :label="t('dashboard.cardStock')">
              <span>
                <el-tag size="small" type="success"
                  >{{ t('cards.status.available') }}: {{ stats.available_cards || 0 }}</el-tag
                >
                <el-tag size="small" type="warning" style="margin-left: 6px"
                  >{{ t('cards.status.locked') }}: {{ stats.locked_cards || 0 }}</el-tag
                >
                <el-tag size="small" type="info" style="margin-left: 6px"
                  >{{ t('cards.status.sold') }}: {{ stats.sold_cards || 0 }}</el-tag
                >
              </span>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>

    <!-- 销售报表 -->
    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :md="12">
        <el-card>
          <template #header
            ><span>{{ t('dashboard.salesTrend') }}</span></template
          >
          <div ref="trendChart" style="height: 260px"></div>
        </el-card>
      </el-col>
      <el-col :md="12">
        <el-card>
          <template #header
            ><span>{{ t('dashboard.productShare') }}</span></template
          >
          <div ref="shareChart" style="height: 260px"></div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 最近交易 -->
    <el-card style="margin-top: 16px">
      <template #header
        ><span>{{ t('dashboard.recentOrders') }}</span></template
      >
      <el-table :data="stats.recent_orders || []" size="small">
        <el-table-column prop="order_no" :label="t('orders.orderNo')" width="220" />
        <el-table-column prop="product_name" :label="t('orders.product')" />
        <el-table-column :label="t('orders.amount')" width="110">
          <template #default="{ row }">{{ row.amount }} {{ row.fiat }}</template>
        </el-table-column>
        <el-table-column :label="t('common.status')" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('orders.createdAt')" width="170">
          <template #default="{ row }">{{ date(row.created_at) }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import * as echarts from 'echarts'
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock, Warning, Failed } from '@element-plus/icons-vue'
import { api } from '@/api'
import { fmtMoney, fmtDate, currencyLabel as getCurrencyLabel } from '@/utils/format'

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

function statusText(status: string) {
  return (t(`orders.status.${status}`) as string) || status
}
function statusType(status: string): any {
  const m: any = {
    paid: 'success',
    processing: 'success',
    delivered: 'success',
    completed: 'success',
    waiting_payment: 'warning',
    created: 'info',
    expired: 'danger',
    payment_failed: 'danger',
    delivery_failed: 'danger',
    cancelled: 'info',
  }
  return m[status] || 'info'
}
function date(ts: number) {
  return fmtDate(ts)
}
onMounted(async () => {
  loading.value = true
  try {
    stats.value = await api.get('/admin/dashboard')
  } finally {
    loading.value = false
  }
  loadCharts()
})

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
</script>

<style scoped>
.stat-sub {
  color: #909399;
  font-size: 12px;
  margin-top: 4px;
}
.alert-row {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}
.alert-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}
.alert-icon.warn {
  background: #fdf6ec;
  color: #e6a23c;
}
.alert-icon.danger {
  background: #fef0f0;
  color: #f56c6c;
}
.alert-title {
  color: #909399;
  font-size: 13px;
}
.alert-value {
  font-size: 22px;
  font-weight: 700;
  color: #303133;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.empty-tip {
  color: #c0c4cc;
  font-size: 13px;
  text-align: center;
  padding: 12px 0;
}
</style>
