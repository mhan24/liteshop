<template>
  <PageCard :title="t('site.title')" :loading="loading">
    <div class="max-w-3xl space-y-4">
      <FormField :label="t('site.siteTitle')">
        <input v-model="form.site_title" class="input input-bordered w-full" />
      </FormField>
      <FormField :label="t('site.publicBaseUrl')" :hint="t('site.publicBaseUrlPlaceholder')">
        <input v-model="form.shop_public_base_url" class="input input-bordered w-full" />
      </FormField>
      <FormField :label="t('site.announcement')">
        <MdEditor v-model="form.site_announcement" :language="editorLang" :preview="false" class="w-full" style="height: 300px" />
      </FormField>
      <FormField :label="t('site.logo')" :hint="t('site.logoPlaceholder')">
        <input v-model="form.site_logo" class="input input-bordered w-full" />
        <div v-if="form.site_logo" class="mt-2 h-16 w-40 border border-base-300 bg-base-200 p-1">
          <img :src="form.site_logo" class="h-full w-full object-contain" alt="logo" @error="(e: any) => (e.target.style.display = 'none')" />
        </div>
      </FormField>
      <FormField :label="t('site.favicon')" :hint="t('site.faviconPlaceholder')">
        <input v-model="form.site_favicon" class="input input-bordered w-full" />
        <div v-if="form.site_favicon" class="mt-2 h-12 w-12 border border-base-300 bg-base-200 p-0.5">
          <img :src="form.site_favicon" class="h-full w-full object-contain" alt="favicon" @error="(e: any) => (e.target.style.display = 'none')" />
        </div>
      </FormField>
      <FormField :label="t('site.defaultProductImage')" :hint="t('site.defaultProductImagePlaceholder')">
        <input v-model="form.default_product_image" class="input input-bordered w-full" />
        <div class="mt-2 h-32 w-32 border border-base-300 bg-base-200 p-1">
          <ProductImage :src="form.default_product_image" :fallback="DEFAULT_IMAGE" />
        </div>
      </FormField>
      <FormField :label="t('site.subtitleNote')">
        <textarea v-model="form.site_subtitle" class="textarea textarea-bordered w-full" rows="3"></textarea>
      </FormField>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField :label="t('site.locale')">
          <select v-model="form.site_locale" class="select select-bordered w-full">
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
          </select>
        </FormField>
        <FormField :label="t('site.currency')">
          <select v-model="form.site_currency" class="select select-bordered w-full">
            <option value="CNY">CNY ¥</option>
            <option value="USD">USD $</option>
            <option value="EUR">EUR €</option>
            <option value="GBP">GBP £</option>
          </select>
        </FormField>
        <FormField :label="t('site.timezone')">
          <input v-model="form.site_timezone" class="input input-bordered w-full" placeholder="Asia/Shanghai" />
        </FormField>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField :label="t('site.stockDisplay')">
          <select v-model="form.stock_display_mode" class="select select-bordered w-full">
            <option value="exact">{{ t('site.stockExact') }}</option>
            <option value="fuzzy">{{ t('site.stockFuzzy') }}</option>
          </select>
        </FormField>
        <FormField :label="t('site.homeViewMode')">
          <div class="flex items-center gap-6 pt-2">
            <label class="flex cursor-pointer items-center gap-2">
              <input v-model="form.home_view_mode" type="radio" name="home_view" value="grid" class="radio radio-primary radio-sm" />
              <span class="text-sm">{{ t('site.viewGrid') }}</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2">
              <input v-model="form.home_view_mode" type="radio" name="home_view" value="list" class="radio radio-primary radio-sm" />
              <span class="text-sm">{{ t('site.viewList') }}</span>
            </label>
          </div>
        </FormField>
      </div>

      <div class="divider">{{ t('site.linksTitle') }}</div>
      <FormField :label="t('site.links')">
        <div class="w-full space-y-2">
          <div v-for="(link, idx) in form.site_links" :key="idx" class="flex flex-wrap items-center gap-2">
            <input v-model="link.name" class="input input-bordered input-sm w-40" :placeholder="t('site.linkName')" />
            <input v-model="link.url" class="input input-bordered input-sm min-w-40 flex-1" :placeholder="t('site.linkUrl')" />
            <select v-model="link.category" class="select select-bordered select-sm w-32">
              <option value="contact">{{ t('site.linkContact') }}</option>
              <option value="link">{{ t('site.linkFriend') }}</option>
            </select>
            <button class="btn btn-ghost btn-error btn-sm" @click="removeLink(idx)">{{ t('site.delete') }}</button>
          </div>
          <button class="btn btn-outline btn-primary btn-sm" @click="addLink">{{ t('site.addLink') }}</button>
        </div>
      </FormField>

      <FormField :label="t('site.copyright')">
        <input v-model="form.site_copyright" class="input input-bordered w-full" />
      </FormField>
      <FormField :label="t('site.privacy')">
        <MdEditor v-model="form.privacy_policy" :language="editorLang" :preview="false" class="w-full" style="height: 300px" />
      </FormField>
      <FormField :label="t('site.terms')">
        <MdEditor v-model="form.terms_of_service" :language="editorLang" :preview="false" class="w-full" style="height: 300px" />
      </FormField>

      <FormField :label="t('site.turnstileSiteKey')">
        <input v-model="form.turnstile_site_key" class="input input-bordered w-full" />
      </FormField>
      <FormField :label="t('site.turnstileSecret')" :hint="t('site.turnstileSecretPlaceholder')">
        <input v-model="form.turnstile_secret" type="password" class="input input-bordered w-full" />
      </FormField>

      <div class="divider">{{ t('site.maintenance') }}</div>
      <FormField :label="t('site.maintenanceEnabled')">
        <input v-model="maintenanceEnabled" type="checkbox" class="toggle toggle-primary" />
      </FormField>
      <FormField :label="t('site.maintenanceMessage')" :hint="t('site.maintenanceMessagePlaceholder')">
        <textarea v-model="form.maintenance_message" class="textarea textarea-bordered w-full" rows="3"></textarea>
      </FormField>
      <FormField :label="t('site.maintenancePassword')" :hint="t('site.maintenancePasswordPlaceholder')">
        <input v-model="form.maintenance_password" type="password" class="input input-bordered w-full" />
      </FormField>

      <button class="btn btn-primary" :class="{ 'btn-disabled': saving }" @click="save">
        <span v-if="saving" class="loading loading-spinner loading-xs"></span>
        {{ t('common.save') }}
      </button>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { api } from '@/api'
import PageCard from '@/components/PageCard.vue'
import FormField from '@/components/ui/FormField.vue'
import ProductImage from '@/components/ui/ProductImage.vue'
import { toastError, toastSuccess } from '@/components/ui/toast'

const { t, locale } = useI18n()
const editorLang = computed(() => (locale.value === 'en' ? 'en-US' : 'zh-CN'))
const loading = ref(false)
const saving = ref(false)
const form = ref<any>({})
const maintenanceEnabled = ref(false)
const DEFAULT_IMAGE = ref('/default-product.svg')

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
    toastSuccess(t('site.saved'))
  } catch (e: any) {
    toastError(e.message)
  } finally {
    saving.value = false
  }
}
</script>
