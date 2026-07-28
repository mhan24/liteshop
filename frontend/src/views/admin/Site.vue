<template>
  <a-spin :spinning="loading">
    <a-typography-title :level="4">站点设置</a-typography-title>
    <a-form layout="vertical" :model="form" @finish="save" style="max-width:680px">
      <a-form-item label="站点标题"><a-input v-model:value="form.site_title" /></a-form-item>
      <a-form-item label="副标题"><a-input v-model:value="form.site_subtitle" /></a-form-item>
      <a-form-item label="简介/公告"><a-textarea v-model:value="form.site_announcement" :rows="4" /></a-form-item>
      <a-form-item label="SEO Description"><a-textarea v-model:value="form.seo_description" :rows="3" /></a-form-item>
      <a-form-item label="SEO Keywords"><a-input v-model:value="form.seo_keywords" /></a-form-item>
      <a-form-item label="联系方式（显示在底部）"><a-textarea v-model:value="form.site_contact" :rows="4" /></a-form-item>
      <a-form-item label="友情链接（每行：名称|https://example.com）"><a-textarea v-model:value="form.site_friend_links" :rows="4" /></a-form-item>
      <a-form-item label="版权所有"><a-input v-model:value="form.site_copyright" /></a-form-item>
      <a-form-item label="隐私政策"><a-textarea v-model:value="form.privacy_policy" :rows="6" /></a-form-item>
      <a-form-item label="服务条款"><a-textarea v-model:value="form.terms_of_service" :rows="6" /></a-form-item>
      <a-form-item label="Turnstile Site Key"><a-input v-model:value="form.turnstile_site_key" /></a-form-item>
      <a-form-item label="Turnstile Secret"><a-input-password v-model:value="form.turnstile_secret" placeholder="留空保持不变" /></a-form-item>
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
const form = ref({})
async function load() {
  loading.value = true
  try {
    form.value = await api.get('/admin/site')
    form.value.turnstile_secret = ''
  } finally {
    loading.value = false
  }
}
async function save() {
  saving.value = true
  try {
    await api.post('/admin/site', form.value)
    message.success('已保存')
  } catch (e) {
    message.error(e.message)
  } finally {
    saving.value = false
  }
}
onMounted(load)
</script>
