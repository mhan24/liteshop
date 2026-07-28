<template>
  <a-spin :spinning="loading">
    <a-card>
      <a-page-header :title="product.name" @back="() => $router.push('/')">
        <template #extra>
          <span class="muted">当前库存 {{ available }}</span>
        </template>
      </a-page-header>
      <p class="muted">{{ product.description }}</p>
      <p class="price-text">{{ money(product.price_cents) }} CNY</p>

      <a-form layout="vertical" :model="form" @finish="submit">
        <a-form-item v-if="tradeTypes.length > 1" label="收款币种/网络">
          <a-select v-model:value="form.trade_type">
            <a-select-option v-for="t in tradeTypes" :key="t" :value="t">{{ t }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="购买数量">
          <a-input-number v-model:value="form.qty" :min="1" :max="available" style="width:100%" />
        </a-form-item>
        <a-form-item label="邮箱（必填，用于查询订单和接收卡密）" name="contact" :rules="[{ required: true, type: 'email', message: '请输入有效邮箱' }]">
          <a-input v-model:value="form.contact" />
        </a-form-item>
        <div ref="turnstile" class="cf-turnstile"></div>
        <a-button type="primary" html-type="submit" :loading="submitting" block>去支付</a-button>
      </a-form>
    </a-card>
  </a-spin>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { api } from '@/api'

const route = useRoute()
const product = ref({})
const available = ref(0)
const tradeTypes = ref([])
const loading = ref(false)
const submitting = ref(false)
const turnstile = ref(null)
const form = ref({ trade_type: '', qty: 1, contact: '' })

function money(cents) {
  return (cents / 100).toFixed(2)
}

function loadTurnstile(sitekey) {
  if (!sitekey) return
  const id = 'turnstile-api'
  if (!document.getElementById(id)) {
    const s = document.createElement('script')
    s.id = id
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    s.async = true
    s.defer = true
    document.head.appendChild(s)
  }
  nextTick(() => {
    setTimeout(() => {
      if (window.turnstile && turnstile.value) {
        turnstile.value.innerHTML = ''
        window.turnstile.render(turnstile.value, { sitekey, action: 'turnstile-spin-v2' })
      }
    }, 300)
  })
}

async function load() {
  loading.value = true
  try {
    const data = await api.get('/products/' + route.params.id)
    product.value = data.product
    available.value = data.available
    tradeTypes.value = data.trade_types || []
    form.value.trade_type = tradeTypes.value[0] || ''
    loadTurnstile(data.turnstile_site_key)
  } finally {
    loading.value = false
  }
}

async function submit() {
  submitting.value = true
  try {
    const tokenInput = document.querySelector('[name="cf-turnstile-response"]')
    const payload = {
      product_id: Number(route.params.id),
      qty: form.value.qty,
      contact: form.value.contact,
      trade_type: form.value.trade_type,
      'cf-turnstile-response': tokenInput ? tokenInput.value : '',
    }
    const res = await api.post('/orders', payload)
    if (res.payment_url) window.location.href = res.payment_url
  } catch (e) {
    message.error(e.message)
  } finally {
    submitting.value = false
  }
}
onMounted(load)
</script>
