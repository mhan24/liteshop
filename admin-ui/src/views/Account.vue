<template>
  <el-card v-loading="loading">
    <template #header><h2>{{ t('account.title') }}</h2></template>
    <el-form ref="formRef" :model="form" label-position="top" style="max-width:480px">
      <el-form-item :label="t('account.username')" prop="username" :rules="[{ required: true, message: t('account.username') }]">
        <el-input v-model="form.username" />
      </el-form-item>
      <el-form-item :label="t('account.currentPassword')" prop="current_password" :rules="[{ required: true, message: t('account.currentPasswordRequired') }]">
        <el-input v-model="form.current_password" type="password" show-password />
      </el-form-item>
      <el-form-item :label="t('account.newPassword')"><el-input v-model="form.new_password" type="password" show-password /></el-form-item>
      <el-form-item :label="t('account.confirmPassword')"><el-input v-model="form.confirm_password" type="password" show-password /></el-form-item>
      <el-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button>
    </el-form>
  </el-card>

  <!-- TOTP 双因素 -->
  <el-card style="margin-top:16px" v-loading="totpLoading">
    <template #header><h2>{{ t('account.totp') }}</h2></template>

    <template v-if="!totp.enabled">
      <p class="muted">{{ t('account.totpHint') }}</p>
      <el-button type="primary" @click="generateTotp">{{ t('account.totpGenerate') }}</el-button>

      <div v-if="totp.secret" style="margin-top:16px">
        <el-alert :title="t('account.totpScanHint')" type="info" :closable="false" />
        <img :src="qrUrl" alt="TOTP QR" style="width:200px;height:200px;margin-top:12px;border:1px solid #eee;border-radius:8px" />
        <p class="muted" style="margin-top:8px">{{ t('account.totpSecret') }}: <code class="mono">{{ totp.secret }}</code></p>
        <div style="margin-top:12px;display:flex;gap:8px">
          <el-input v-model="totpCode" :placeholder="t('account.totpCodePlaceholder')" style="width:220px" />
          <el-button type="primary" :loading="totpSaving" @click="enableTotp">{{ t('account.totpConfirm') }}</el-button>
        </div>
      </div>
    </template>

    <template v-else>
      <el-tag type="success">{{ t('account.totpEnabled') }}</el-tag>
      <div style="margin-top:12px;display:flex;gap:8px">
        <el-input v-model="disableCode" :placeholder="t('account.totpCodePlaceholder')" style="width:220px" />
        <el-button type="danger" plain :loading="totpSaving" @click="disableTotp">{{ t('account.totpDisable') }}</el-button>
      </div>
    </template>
  </el-card>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, FormInstance } from 'element-plus'
import { api } from '@/api'

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({ username: '', current_password: '', new_password: '', confirm_password: '' })

const totpLoading = ref(false)
const totpSaving = ref(false)
const totp = ref<any>({ enabled: false, secret: '', issuer: 'LiteShop' })
const totpCode = ref('')
const disableCode = ref('')
const qrUrl = computed(() => {
  if (!totp.value.secret) return ''
  const otpauth = `otpauth://totp/${encodeURIComponent(form.username || 'admin')}?secret=${totp.value.secret}&issuer=${encodeURIComponent(totp.value.issuer || 'LiteShop')}&digits=6&period=30`
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauth)}`
})

onMounted(async () => {
  loading.value = true
  try {
    const data = await api.get<{ username: string }>('/admin/account')
    form.username = data.username
  } finally {
    loading.value = false
  }
  await loadTotp()
})

async function loadTotp() {
  totpLoading.value = true
  try {
    const data = await api.get('/admin/totp')
    totp.value = { ...data, secret: data.enabled ? '' : data.secret }
  } finally {
    totpLoading.value = false
  }
}
async function generateTotp() {
  totpLoading.value = true
  try {
    const data = await api.get('/admin/totp')
    totp.value.secret = data.secret
    totp.value.issuer = data.issuer
  } finally {
    totpLoading.value = false
  }
}
async function enableTotp() {
  totpSaving.value = true
  try {
    await api.post('/admin/totp/enable', { secret: totp.value.secret, otp: totpCode.value })
    ElMessage.success(t('account.totpDone'))
    await loadTotp()
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    totpSaving.value = false
  }
}
async function disableTotp() {
  totpSaving.value = true
  try {
    await api.post('/admin/totp/disable', { otp: disableCode.value })
    ElMessage.success(t('account.totpDisabled'))
    await loadTotp()
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    totpSaving.value = false
  }
}

async function save() {
  if (!formRef.value) return
  await formRef.value.validate(async (ok) => {
    if (!ok) return
    saving.value = true
    try {
      await api.post('/admin/account', form)
      ElMessage.success(t('account.saved'))
      form.current_password = ''
      form.new_password = ''
      form.confirm_password = ''
    } catch (e: any) {
      ElMessage.error(e.message)
    } finally {
      saving.value = false
    }
  })
}
</script>

<style scoped>
.muted {
  color: #999;
  font-size: 13px;
}
.mono {
  font-family: ui-monospace, monospace;
}
</style>
