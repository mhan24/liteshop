<template>
  <el-card v-loading="loading">
    <template #header><h2>账号设置</h2></template>
    <el-form ref="formRef" :model="form" label-position="top" style="max-width:480px">
      <el-form-item label="用户名" prop="username" :rules="[{ required: true, message: '请输入用户名' }]">
        <el-input v-model="form.username" />
      </el-form-item>
      <el-form-item label="当前密码" prop="current_password" :rules="[{ required: true, message: '请输入当前密码' }]">
        <el-input v-model="form.current_password" type="password" show-password />
      </el-form-item>
      <el-form-item label="新密码（留空不修改）"><el-input v-model="form.new_password" type="password" show-password /></el-form-item>
      <el-form-item label="确认新密码"><el-input v-model="form.confirm_password" type="password" show-password /></el-form-item>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { ElMessage, FormInstance } from 'element-plus'
import { api } from '@/api'

const loading = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const form = reactive({ username: '', current_password: '', new_password: '', confirm_password: '' })

onMounted(async () => {
  loading.value = true
  try {
    const data = await api.get<{ username: string }>('/admin/account')
    form.username = data.username
  } finally {
    loading.value = false
  }
})

async function save() {
  if (!formRef.value) return
  await formRef.value.validate(async (ok) => {
    if (!ok) return
    saving.value = true
    try {
      await api.post('/admin/account', form)
      ElMessage.success('已保存')
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
