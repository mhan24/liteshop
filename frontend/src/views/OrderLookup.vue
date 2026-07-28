<template>
  <a-card title="订单查询">
    <a-alert
      type="info"
      show-icon
      message="忘记订单号？只填下单邮箱即可找回最近订单和付款链接。"
      style="margin-bottom:16px"
    />
    <a-form layout="vertical" :model="form" @finish="submit">
      <a-form-item label="下单邮箱" name="contact" :rules="[{ required: true, type: 'email', message: '请输入下单时填写的邮箱' }]">
        <a-input v-model:value="form.contact" placeholder="you@example.com" allow-clear />
      </a-form-item>
      <a-form-item label="订单号（可选，填写后精确查询单个订单）" name="order_no">
        <a-input v-model:value="form.order_no" placeholder="留空则按邮箱找回最近订单" allow-clear />
      </a-form-item>
      <a-button type="primary" html-type="submit" :loading="loading" block>
        {{ form.order_no ? '查询该订单' : '用邮箱找回订单' }}
      </a-button>
    </a-form>

    <a-spin :spinning="loading" style="margin-top:20px">
      <a-empty v-if="!loading && !orders.length && searched" description="没有找到相关订单" />
      <a-list v-if="orders.length" :data-source="orders" bordered>
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title>
                <a-space wrap>
                  <span>{{ item.product_name }} x{{ item.qty }}</span>
                  <a-tag :color="color(item.status)">{{ statusText(item.status) }}</a-tag>
                  <span class="muted">{{ money(item) }} {{ item.fiat }}</span>
                </a-space>
              </template>
              <template #description>
                <span v-if="item.order_no">订单号：<code>{{ item.order_no }}</code> · {{ date(item.created_at) }}</span>
                <span v-else>已支付订单 · 卡密已发送到邮箱，如需查看请用订单号 + 邮箱查询 · {{ date(item.paid_at || item.created_at) }}</span>
              </template>
            </a-list-item-meta>
            <template #actions>
              <a-button v-if="item.url" type="primary" size="small" @click="open(item.url)">查看订单</a-button>
              <a-button v-if="item.payment_url" size="small" type="primary" ghost @click="open(item.payment_url)">继续支付</a-button>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-spin>
  </a-card>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import { api } from '@/api'

const form = reactive({ order_no: '', contact: '' })
const loading = ref(false)
const searched = ref(false)
const orders = ref([])

async function submit() {
  if (form.order_no) {
    window.location.href = '/order/' + form.order_no + '?contact=' + encodeURIComponent(form.contact)
    return
  }
  await search()
}
async function search() {
  loading.value = true
  searched.value = true
  orders.value = []
  try {
    const data = await api.get('/orders', { contact: form.contact })
    orders.value = data.orders || []
  } catch (e) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}
function open(url) {
  window.location.href = url
}
function money(item) {
  return item.amount
}
function date(ts) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}
function color(status) {
  return { paid: 'success', pending: 'warning', expired: 'error', failed: 'default' }[status] || 'default'
}
function statusText(status) {
  return { paid: '已支付', pending: '待支付', expired: '已过期', failed: '失败' }[status] || status
}
</script>
