<template>
  <el-card v-loading="loading">
    <template #header><h2>站点设置</h2></template>
    <el-form label-position="top" :model="form" style="max-width:680px">
      <el-form-item label="站点标题"><el-input v-model="form.site_title" /></el-form-item>
      <el-form-item label="副标题"><el-input v-model="form.site_subtitle" /></el-form-item>
      <el-form-item label="简介/公告"><el-input v-model="form.site_announcement" type="textarea" :rows="4" /></el-form-item>
      <el-form-item label="SEO Description"><el-input v-model="form.seo_description" type="textarea" :rows="3" /></el-form-item>
      <el-form-item label="SEO Keywords"><el-input v-model="form.seo_keywords" /></el-form-item>
      <el-form-item label="联系方式（显示在底部）"><el-input v-model="form.site_contact" type="textarea" :rows="4" /></el-form-item>
      <el-form-item label="友情链接（每行：名称|https://example.com）"><el-input v-model="form.site_friend_links" type="textarea" :rows="4" /></el-form-item>
      <el-form-item label="版权所有"><el-input v-model="form.site_copyright" /></el-form-item>
      <el-form-item label="隐私政策"><el-input v-model="form.privacy_policy" type="textarea" :rows="6" /></el-form-item>
      <el-form-item label="服务条款"><el-input v-model="form.terms_of_service" type="textarea" :rows="6" /></el-form-item>
      <el-form-item label="Turnstile Site Key"><el-input v-model="form.turnstile_site_key" /></el-form-item>
      <el-form-item label="Turnstile Secret"><el-input v-model="form.turnstile_secret" type="password" placeholder="留空保持不变" show-password /></el-form-item>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/api'

const loading = ref(false)
const saving = ref(false)
const form = ref<any>({})

onMounted(async () => {
  loading.value = true
  try {
    form.value = await api.get('/admin/site')
    form.value.turnstile_secret = ''
  } finally {
    loading.value = false
  }
})
async function save() {
  saving.value = true
  try {
    await api.post('/admin/site', form.value)
    ElMessage.success('已保存')
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}
</script>
