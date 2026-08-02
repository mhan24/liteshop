<template>
  <el-card v-loading="loading">
    <template #header><h2>{{ t('site.title') }}</h2></template>
    <el-form label-position="top" :model="form" style="max-width:680px">
      <el-form-item :label="t('site.siteTitle')"><el-input v-model="form.site_title" /></el-form-item>
      <el-form-item :label="t('site.announcement')">
        <MdEditor v-model="form.site_announcement" :language="editorLang" :preview="false" style="height:300px;width:100%" />
      </el-form-item>
      <el-form-item :label="t('site.defaultProductImage')">
        <el-input v-model="form.default_product_image" :placeholder="t('site.defaultProductImagePlaceholder')" />
        <el-image :src="form.default_product_image" fit="contain" style="width:120px;height:120px;margin-top:8px;border:1px solid #eee;border-radius:8px">
          <template #error>.</template>
        </el-image>
      </el-form-item>
      <el-form-item :label="t('site.subtitleNote')">
        <el-input v-model="form.site_subtitle" type="textarea" :rows="3" />
      </el-form-item>

      <el-divider content-position="left">{{ t('site.linksTitle') }}</el-divider>
      <el-form-item :label="t('site.links')">
        <div class="link-list">
          <div v-for="(link, idx) in form.site_links" :key="idx" class="link-row">
            <el-input v-model="link.name" :placeholder="t('site.linkName')" />
            <el-input v-model="link.url" :placeholder="t('site.linkUrl')" />
            <el-select v-model="link.category" style="width:130px">
              <el-option :label="t('site.linkContact')" value="contact" />
              <el-option :label="t('site.linkFriend')" value="link" />
            </el-select>
            <el-button type="danger" text @click="removeLink(idx)">{{ t('site.delete') }}</el-button>
          </div>
          <el-button type="primary" plain @click="addLink">{{ t('site.addLink') }}</el-button>
        </div>
      </el-form-item>

      <el-form-item :label="t('site.copyright')"><el-input v-model="form.site_copyright" /></el-form-item>
      <el-form-item :label="t('site.privacy')">
        <MdEditor v-model="form.privacy_policy" :language="editorLang" :preview="false" style="height:300px;width:100%" />
      </el-form-item>
      <el-form-item :label="t('site.terms')">
        <MdEditor v-model="form.terms_of_service" :language="editorLang" :preview="false" style="height:300px;width:100%" />
      </el-form-item>
      <el-form-item :label="t('site.turnstileSiteKey')"><el-input v-model="form.turnstile_site_key" /></el-form-item>
      <el-form-item :label="t('site.turnstileSecret')"><el-input v-model="form.turnstile_secret" type="password" :placeholder="t('site.turnstileSecretPlaceholder')" show-password /></el-form-item>

      <el-divider content-position="left">{{ t('site.maintenance') }}</el-divider>
      <el-form-item :label="t('site.maintenanceEnabled')">
        <el-switch v-model="maintenanceEnabled" />
      </el-form-item>
      <el-form-item :label="t('site.maintenanceMessage')">
        <el-input v-model="form.maintenance_message" type="textarea" :rows="3" :placeholder="t('site.maintenanceMessagePlaceholder')" />
      </el-form-item>
      <el-form-item :label="t('site.maintenancePassword')">
        <el-input v-model="form.maintenance_password" type="password" :placeholder="t('site.maintenancePasswordPlaceholder')" show-password />
      </el-form-item>

      <el-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button>
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { api } from '@/api'

const { t, locale } = useI18n()
const editorLang = computed(() => (locale.value === 'en' ? 'en-US' : 'zh-CN'))
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
    ElMessage.success(t('site.saved'))
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
