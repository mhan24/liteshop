<template>
  <PageCard :title="isEdit ? t('products.edit') : t('products.new')" :loading="loading">
    <div class="max-w-2xl space-y-5">
      <FormField :label="t('products.name')" required>
        <Input v-model="form.name" />
      </FormField>

      <FormField :label="t('products.priceCny')" required>
        <Input v-model.number="form.price" type="number" step="0.01" min="0.01" />
      </FormField>

      <FormField :label="t('products.deliveryType')" :hint="t('products.manualDeliveryHint')">
        <Select v-model="form.delivery_type">
          <SelectTrigger class="w-full">
            <SelectValue :placeholder="t('products.deliveryType')" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{{ t('products.autoDelivery') }}</SelectItem>
            <SelectItem value="manual">{{ t('products.manualDelivery') }}</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField :label="t('products.minQty')">
          <Input v-model.number="form.min_qty" type="number" min="1" />
        </FormField>
        <FormField :label="t('products.maxQty')">
          <Input v-model.number="form.max_qty" type="number" min="1" />
        </FormField>
        <FormField :label="t('products.cost')">
          <Input v-model.number="form.cost" type="number" step="0.01" min="0" />
        </FormField>
      </div>

      <FormField :label="t('products.wholesale')">
        <div class="w-full space-y-2">
          <div v-for="(tier, idx) in form.wholesale" :key="idx" class="flex flex-wrap items-center gap-2">
            <Input v-model.number="tier.min_qty" type="number" min="2" class="w-28" />
            <Input v-model.number="tier.discount" type="number" min="1" max="99" class="w-28" />
            <span class="text-sm text-muted-foreground">%</span>
            <Button variant="ghost" size="sm" class="text-destructive" @click="removeWholesale(idx)">
              {{ t('site.delete') }}
            </Button>
          </div>
          <Button variant="outline" size="sm" @click="addWholesale">{{ t('products.addWholesale') }}</Button>
        </div>
      </FormField>

      <FormField :label="t('products.description')">
        <MdEditor v-model="form.description" :language="editorLang" :preview="false" class="w-full" style="height: 420px" />
      </FormField>

      <FormField :label="t('products.faq')">
        <div class="w-full space-y-3">
          <div v-for="(item, idx) in form.faq" :key="idx" class="space-y-2 rounded-lg border bg-muted/30 p-3">
            <Input v-model="item.q" :placeholder="t('products.faqQ')" />
            <Textarea v-model="item.a" rows="2" :placeholder="t('products.faqA')" />
            <Button variant="ghost" size="sm" class="text-destructive" @click="removeFaq(idx)">
              {{ t('site.delete') }}
            </Button>
          </div>
          <Button variant="outline" size="sm" @click="addFaq">{{ t('products.addFaq') }}</Button>
        </div>
      </FormField>

      <FormField :label="t('products.imageUrl')" :hint="t('products.imageUrlPlaceholder')">
        <Input v-model="form.image_url" />
        <div class="mt-2 h-32 w-32 overflow-hidden rounded-lg border bg-muted">
          <ProductImage :src="form.image_url" :fallback="DEFAULT_IMAGE" />
        </div>
      </FormField>

      <FormField :label="t('products.categoryPlaceholder')">
        <Input v-model="form.category" />
      </FormField>

      <FormField :label="t('products.sort')">
        <Input v-model.number="form.sort_order" type="number" min="0" />
      </FormField>

      <div class="flex items-center gap-6">
        <div class="flex items-center gap-2">
          <Checkbox id="pinned" :checked="pinned" @update:checked="pinned = $event" />
          <Label for="pinned" class="text-sm">{{ t('products.pinned') }}</Label>
        </div>
        <div class="flex items-center gap-2">
          <Checkbox id="active" :checked="active" @update:checked="active = $event" />
          <Label for="active" class="text-sm">{{ t('products.onSale') }}</Label>
        </div>
      </div>

      <div class="flex items-center gap-2 pt-2">
        <Button :disabled="saving" @click="save">
          <Loader2 v-if="saving" class="animate-spin" />
          {{ t('common.save') }}
        </Button>
        <Button variant="ghost" @click="$router.back()">{{ t('common.back') }}</Button>
      </div>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { api } from '@/api'
import PageCard from '@/components/PageCard.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import FormField from '@/components/FormField.vue'
import ProductImage from '@/components/ProductImage.vue'
import { toastError, toastSuccess, toastWarning } from '@/components/toast'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const editorLang = computed(() => (locale.value === 'en' ? 'en-US' : 'zh-CN'))
const loading = ref(false)
const saving = ref(false)
const isEdit = computed(() => !!route.params.id)
const pinned = ref(false)
const active = ref(true)
const form = reactive({
  name: '',
  price: 0.01,
  description: '',
  image_url: '',
  category: '',
  sort_order: 0,
  delivery_type: 'auto',
  faq: [] as { q: string; a: string }[],
  min_qty: 1,
  max_qty: 100,
  cost: 0,
  wholesale: [] as { min_qty: number; discount: number }[],
})

const DEFAULT_IMAGE = ref('/default-product.svg')

function addFaq() {
  form.faq.push({ q: '', a: '' })
}
function removeFaq(idx: number) {
  form.faq.splice(idx, 1)
}
function addWholesale() {
  form.wholesale.push({ min_qty: 2, discount: 95 })
}
function removeWholesale(idx: number) {
  form.wholesale.splice(idx, 1)
}

onMounted(async () => {
  try {
    const site = await api.get('/admin/site')
    if (site.default_product_image) DEFAULT_IMAGE.value = site.default_product_image
  } catch {
    // ignore
  }
  if (!isEdit.value) return
  loading.value = true
  try {
    const data = await api.get('/admin/products/' + route.params.id)
    Object.assign(form, data.product)
    form.price = data.product.price_cents / 100
    form.cost = (data.product.cost_cents || 0) / 100
    if (!Array.isArray(form.wholesale)) form.wholesale = []
    pinned.value = data.product.is_pinned
    active.value = data.product.status === 'active'
  } finally {
    loading.value = false
  }
})

async function save() {
  if (!form.name.trim()) {
    toastWarning(t('products.nameRequired'))
    return
  }
  if (!form.price || form.price <= 0) {
    toastWarning(t('products.priceRequired'))
    return
  }
  saving.value = true
  try {
    const payload: any = { ...form, is_pinned: pinned.value, status: active.value ? 'active' : 'disabled' }
    payload.price = form.price
    payload.cost_cents = Math.round((form.cost || 0) * 100)
    delete payload.price_cents
    delete payload.cost
    if (isEdit.value) await api.post('/admin/products/' + route.params.id + '/edit', payload)
    else await api.post('/admin/products', payload)
    toastSuccess(t('products.saveSuccess'))
    router.push('/products')
  } catch (e: any) {
    toastError(e.message)
  } finally {
    saving.value = false
  }
}
</script>
