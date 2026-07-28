<template>
  <a-spin :spinning="loading">
    <a-typography-title :level="4">账号设置</a-typography-title>
    <a-form layout="vertical" :model="form" @finish="save" style="max-width:480px">
      <a-form-item label="用户名" name="username" :rules="[{ required: true, message: '请输入用户名' }]"><a-input v-model:value="form.username" /></a-form-item>
      <a-form-item label="当前密码" name="current_password" :rules="[{ required: true, message: '请输入当前密码' }]"><a-input-password v-model:value="form.current_password" /></a-form-item>
      <a-form-item label="新密码（留空不修改）"><a-input-password v-model:value="form.new_password" /></a-form-item>
      <a-form-item label="确认新密码"><a-input-password v-model:value="form.confirm_password" /></a-form-item>
      <a-button type="primary" html-type="submit" :loading="saving">保存</a-button>
    </a-form>
  </a-spin>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { api } from '@/api'
const loading = ref(false)
const saving = ref(false)
const form = ref({ username: '', current_password: '', new_password: '', confirm_password: '' })
async function load() {
  loading.value = true
  try {
    const data = await api.get('/admin/account')
    form.value.username = data.username
  } finally {
    loading.value = false
  }
}
async function save() {
  saving.value = true
  try {
    await api.post('/admin/account', form.value)
    message.success('已保存')
    form.value.current_password = ''
    form.value.new_password = ''
    form.value.confirm_password = ''
  } catch (e) {
    message.error(e.message)
  } finally {
    saving.value = false
  }
}
onMounted(load)
</script>
