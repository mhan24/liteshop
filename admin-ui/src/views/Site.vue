<template>
  <PageCard :title="t('site.title')" :loading="loading">
    <div class="max-w-3xl space-y-5">
      <FormField :label="t('site.siteTitle')">
        <Input v-model="form.site_title" />
      </FormField>
      <FormField :label="t('site.publicBaseUrl')" :hint="t('site.publicBaseUrlPlaceholder')">
        <Input v-model="form.shop_public_base_url" />
      </FormField>
      <FormField :label="t('site.announcement')">
        <MdEditor
          v-model="form.site_announcement"
          :language="editorLang"
          :preview="false"
          class="w-full"
          style="height: 300px"
        />
      </FormField>
      <FormField :label="t('site.logo')" :hint="t('site.logoPlaceholder')">
        <Input v-model="form.site_logo" />
        <div v-if="form.site_logo" class="mt-2 h-16 w-40 overflow-hidden rounded-lg border bg-muted">
          <img
            :src="form.site_logo"
            class="h-full w-full object-contain"
            alt="logo"
            @error="(e: any) => (e.target.style.display = 'none')"
          />
        </div>
      </FormField>
      <FormField :label="t('site.favicon')" :hint="t('site.faviconPlaceholder')">
        <Input v-model="form.site_favicon" />
        <div v-if="form.site_favicon" class="mt-2 h-12 w-12 overflow-hidden rounded-lg border bg-muted p-0.5">
          <img
            :src="form.site_favicon"
            class="h-full w-full object-contain"
            alt="favicon"
            @error="(e: any) => (e.target.style.display = 'none')"
          />
        </div>
      </FormField>
      <FormField :label="t('site.defaultProductImage')" :hint="t('site.defaultProductImagePlaceholder')">
        <Input v-model="form.default_product_image" />
        <div class="mt-2 h-32 w-32 overflow-hidden rounded-lg border bg-muted">
          <ProductImage :src="form.default_product_image" :fallback="DEFAULT_IMAGE" />
        </div>
      </FormField>
      <FormField :label="t('site.subtitleNote')">
        <Textarea v-model="form.site_subtitle" rows="3" />
      </FormField>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField :label="t('site.locale')">
          <Select v-model="form.site_locale">
            <SelectTrigger class="w-full">
              <SelectValue :placeholder="t('site.locale')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">简体中文</SelectItem>
              <SelectItem value="en-US">English</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField :label="t('site.currency')">
          <Select v-model="form.site_currency">
            <SelectTrigger class="w-full">
              <SelectValue :placeholder="t('site.currency')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CNY">CNY ¥</SelectItem>
              <SelectItem value="USD">USD $</SelectItem>
              <SelectItem value="EUR">EUR €</SelectItem>
              <SelectItem value="GBP">GBP £</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField :label="t('site.timezone')">
          <Input v-model="form.site_timezone" placeholder="Asia/Shanghai" />
        </FormField>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField :label="t('site.stockDisplay')">
          <Select v-model="form.stock_display_mode">
            <SelectTrigger class="w-full">
              <SelectValue :placeholder="t('site.stockDisplay')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="exact">{{ t('site.stockExact') }}</SelectItem>
              <SelectItem value="fuzzy">{{ t('site.stockFuzzy') }}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField :label="t('site.homeViewMode')">
          <RadioGroup v-model="form.home_view_mode" class="flex items-center gap-6 pt-1">
            <div class="flex items-center gap-2">
              <RadioGroupItem id="view-grid" value="grid" />
              <Label for="view-grid" class="text-sm">{{ t('site.viewGrid') }}</Label>
            </div>
            <div class="flex items-center gap-2">
              <RadioGroupItem id="view-list" value="list" />
              <Label for="view-list" class="text-sm">{{ t('site.viewList') }}</Label>
            </div>
          </RadioGroup>
        </FormField>
      </div>

      <Separator />
      <h3 class="font-semibold">{{ t('site.linksTitle') }}</h3>
      <FormField :label="t('site.links')">
        <div class="w-full space-y-2">
          <div v-for="(link, idx) in form.site_links" :key="idx" class="flex flex-wrap items-center gap-2">
            <Input v-model="link.name" class="w-40" :placeholder="t('site.linkName')" />
            <Input v-model="link.url" class="min-w-40 flex-1" :placeholder="t('site.linkUrl')" />
            <Select v-model="link.category">
              <SelectTrigger class="w-32">
                <SelectValue :placeholder="t('site.linkCategory')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contact">{{ t('site.linkContact') }}</SelectItem>
                <SelectItem value="link">{{ t('site.linkFriend') }}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" class="text-destructive" @click="removeLink(idx)">
              {{ t('site.delete') }}
            </Button>
          </div>
          <Button variant="outline" size="sm" @click="addLink">{{ t('site.addLink') }}</Button>
        </div>
      </FormField>

      <FormField :label="t('site.copyright')">
        <Input v-model="form.site_copyright" />
      </FormField>
      <FormField :label="t('site.privacy')">
        <MdEditor
          v-model="form.privacy_policy"
          :language="editorLang"
          :preview="false"
          class="w-full"
          style="height: 300px"
        />
      </FormField>
      <FormField :label="t('site.terms')">
        <MdEditor
          v-model="form.terms_of_service"
          :language="editorLang"
          :preview="false"
          class="w-full"
          style="height: 300px"
        />
      </FormField>

      <FormField :label="t('site.turnstileSiteKey')">
        <Input v-model="form.turnstile_site_key" />
      </FormField>
      <FormField :label="t('site.turnstileSecret')" :hint="t('site.turnstileSecretPlaceholder')">
        <Input v-model="form.turnstile_secret" type="password" />
      </FormField>

      <Separator />
      <h3 class="font-semibold">{{ t('site.maintenance') }}</h3>
      <div class="flex items-center gap-2">
        <Switch id="maintenance" :checked="maintenanceEnabled" @update:checked="maintenanceEnabled = $event" />
        <Label for="maintenance" class="text-sm">{{ t('site.maintenanceEnabled') }}</Label>
      </div>
      <FormField :label="t('site.maintenanceMessage')" :hint="t('site.maintenanceMessagePlaceholder')">
        <Textarea v-model="form.maintenance_message" rows="3" />
      </FormField>
      <FormField :label="t('site.maintenancePassword')" :hint="t('site.maintenancePasswordPlaceholder')">
        <Input v-model="form.maintenance_password" type="password" />
      </FormField>

      <Button :disabled="saving" @click="save">
        <Loader2 v-if="saving" class="animate-spin" />
        {{ t('common.save') }}
      </Button>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { api } from '@/api'
import PageCard from '@/components/PageCard.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import FormField from '@/components/FormField.vue'
import ProductImage from '@/components/ProductImage.vue'
import { toastError, toastSuccess } from '@/components/toast'

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
function removeLink(idx: number | string) {
  form.value.site_links.splice(Number(idx), 1)
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
