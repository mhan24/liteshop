<template>
  <div class="setup-wrap">
    <a-card class="setup-card" title="初始化设置">
      <a-alert v-if="error" type="error" show-icon :message="error" style="margin-bottom:16px" />
      <a-form layout="vertical" :model="form" @finish="submit">
        <a-form-item label="站点标题" name="site_title" :rules="[{ required: true }]">
          <a-input v-model:value="form.site_title" placeholder="LiteShop" />
        </a-form-item>
        <a-form-item label="管理员用户名" name="username" :rules="[{ required: true }]">
          <a-input v-model:value="form.username" placeholder="admin" />
        </a-form-item>
        <a-form-item label="管理员密码（至少 8 位）" name="password" :rules="[{ required: true, min: 8, message: '至少 8 位' }]">
          <a-input-password v-model:value="form.password" />
        </a-form-item>
        <a-form-item label="确认管理员密码" name="confirm" :rules="[{ required: true }]">
          <a-input-password v-model:value="form.confirm" />
        </a-form-item>
        <a-form-item label="前台公开地址">
          <a-input v-model:value="form.public_base_url" placeholder="https://shop.example.com" />
        </a-form-item>
        <a-form-item label="BEpusdt Base URL">
          <a-input v-model:value="form.bepusdt_base_url" placeholder="https://pay.example.com" />
        </a-form-item>
        <a-form-item label="BEpusdt API Token">
          <a-input v-model:value="form.bepusdt_api_token" placeholder="可稍后在后台配置" />
        </a-form-item>
        <a-form-item label="收款类型（逗号分隔）">
          <a-input v-model:value="form.trade_types" placeholder="usdt.trc20,usdt.erc20,usdt.bep20" />
        </a-form-item>
        <a-form-item label="法币">
          <a-input v-model:value="form.fiat" placeholder="CNY" />
        </a-form-item>
        <a-form-item label="Turnstile Site Key">
          <a-input v-model:value="form.turnstile_site_key" placeholder="可选" />
        </a-form-item>
        <a-form-item label="Turnstile Secret">
          <a-input-password v-model:value="form.turnstile_secret" placeholder="可选" />
        </a-form-item>
        <a-button type="primary" html-type="submit" :loading="loading" block>完成初始化</a-button>
      </a-form>
    </a-card>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { api } from '@/api'

const router = useRouter()
const loading = ref(false)
const error = ref('')
const form = reactive({
  site_title: 'LiteShop',
  username: 'admin',
  password: '',
  confirm: '',
  public_base_url: '',
  bepusdt_base_url: '',
  bepusdt_api_token: '',
  trade_types: '',
  fiat: 'CNY',
  turnstile_site_key: '',
  turnstile_secret: '',
})

onMounted(async () => {
  try {
    const data = await api.get('/setup')
    if (data.initialized) router.replace('/admin/login')
    if (data.site_title) form.site_title = data.site_title
  } catch (e) {
    // ignore
  }
})

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await api.post('/setup', form)
    message.success('初始化完成')
    router.push('/admin/login')
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.setup-wrap {
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 16px;
  background: #f5f7fa;
}
.setup-card {
  width: 100%;
  max-width: 560px;
}
</style>
