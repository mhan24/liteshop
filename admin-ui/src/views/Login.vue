<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <template #header><h2>{{ t('login.title') }}</h2></template>
      <el-form ref="formRef" :model="form" label-position="top">
        <el-form-item :label="t('login.username')" prop="username" :rules="[{ required: true, message: t('login.usernameRequired') }]">
          <el-input v-model="form.username" @keyup.enter="submit" />
        </el-form-item>
        <el-form-item :label="t('login.password')" prop="password" :rules="[{ required: true, message: t('login.passwordRequired') }]">
          <el-input v-model="form.password" type="password" show-password @keyup.enter="submit" />
        </el-form-item>
        <el-button type="primary" :loading="loading" @click="submit" style="width:100%">{{ t('login.login') }}</el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { api } from '@/api'

const router = useRouter()
const { t } = useI18n()
const loading = ref(false)
const formRef = ref()
const form = reactive({ username: '', password: '' })

onMounted(async () => {
  try {
    const data = await api.get<{ initialized?: boolean }>('/setup')
    if (!data.initialized) window.location.href = '/setup'
  } catch {
    // ignore
  }
})

async function submit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  loading.value = true
  try {
    await api.post('/admin/login', form)
    window.location.href = '/admin/'
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  padding: 16px;
}
.login-card {
  width: 380px;
}
</style>
