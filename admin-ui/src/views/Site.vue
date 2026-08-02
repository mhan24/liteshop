<template>
  <el-card v-loading="loading">
    <template #header><h2>站点设置</h2></template>
    <el-form label-position="top" :model="form" style="max-width:680px">
      <el-form-item label="站点标题"><el-input v-model="form.site_title" /></el-form-item>
      <el-form-item label="副标题"><el-input v-model="form.site_subtitle" /></el-form-item>
      <el-form-item label="简介/公告"><el-input v-model="form.site_announcement" type="textarea" :rows="4" /></el-form-item>
      <el-form-item label="SEO Description"><el-input v-model="form.seo_description" type="textarea" :rows="3" /></el-form-item>
      <el-form-item label="SEO Keywords"><el-input v-model="form.seo_keywords" /></el-form-item>
      <el-divider content-position="left">联系方式 / 友情链接</el-divider>
      <el-form-item label="链接（名称 / 链接 / 分类，可增删）">
        <div class="link-list">
          <div v-for="(link, idx) in form.site_links" :key="idx" class="link-row">
            <el-input v-model="link.name" placeholder="名称" />
            <el-input v-model="link.url" placeholder="链接（https://… 或 邮箱/@用户名）" />
            <el-select v-model="link.category" style="width:130px">
              <el-option label="联系方式" value="contact" />
              <el-option label="友情链接" value="link" />
            </el-select>
            <el-button type="danger" text @click="removeLink(idx)">删除</el-button>
          </div>
          <el-button type="primary" plain @click="addLink">添加链接</el-button>
        </div>
      </el-form-item>
      <el-form-item label="版权所有"><el-input v-model="form.site_copyright" /></el-form-item>
      <el-form-item label="隐私政策"><el-input v-model="form.privacy_policy" type="textarea" :rows="6" /></el-form-item>
      <el-form-item label="服务条款"><el-input v-model="form.terms_of_service" type="textarea" :rows="6" /></el-form-item>
      <el-form-item label="Turnstile Site Key"><el-input v-model="form.turnstile_site_key" /></el-form-item>
      <el-form-item label="Turnstile Secret"><el-input v-model="form.turnstile_secret" type="password" placeholder="留空保持不变" show-password /></el-form-item>
      <el-divider content-position="left">维护模式</el-divider>
      <el-form-item label="开启维护（前台将显示维护通知并禁止访问）">
        <el-switch v-model="maintenanceEnabled" />
      </el-form-item>
      <el-form-item label="维护通知内容">
        <el-input v-model="form.maintenance_message" type="textarea" :rows="3" placeholder="例如：系统维护中，请稍后再来。" />
      </el-form-item>
      <el-form-item label="维护解锁密码（留空保持不变；开启维护后输入此密码可访问前台）">
        <el-input v-model="form.maintenance_password" type="password" placeholder="设置后输入密码可解锁访问" show-password />
      </el-form-item>
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
const maintenanceEnabled = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    form.value = await api.get('/admin/site')
    maintenanceEnabled.value = String(form.value.maintenance_enabled) === '1'
    form.value.turnstile_secret = ''
    form.value.maintenance_password = ''
    if (!Array.isArray(form.value.site_links)) form.value.site_links = []
  } finally {
    loading.value = false
  }
})
function addLink() {
  form.value.site_links.push({ name: '', url: '', category: 'link' })
}
function removeLink(idx: number) {
  form.value.site_links.splice(idx, 1)
}
async function save() {
  saving.value = true
  try {
    await api.post('/admin/site', { ...form.value, maintenance_enabled: maintenanceEnabled.value ? '1' : '' })
    ElMessage.success('已保存')
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.link-list {
  width: 100%;
}
.link-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  width: 100%;
}
.link-row .el-input,
.link-row .el-select {
  flex: 1;
}
.link-row .el-select {
  flex: 0 0 130px;
}
@media (max-width: 640px) {
  .link-row {
    flex-wrap: wrap;
  }
  .link-row .el-input,
  .link-row .el-select {
    flex: 1 1 100%;
  }
}
</style>
