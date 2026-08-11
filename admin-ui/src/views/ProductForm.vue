<template>
  <PageCard :title="isEdit ? t('products.edit') : t('products.new')" :loading="loading">
    <div class="max-w-2xl space-y-4">
      <FormField :label="t('products.name')" required>
        <input v-model="form.name" class="input input-bordered w-full" />
      </FormField>

      <FormField :label="t('products.priceCny')" required>
        <input v-model.number="form.price" type="number" step="0.01" min="0.01" class="input input-bordered w-full" />
      </FormField>

      <FormField :label="t('products.deliveryType')" :hint="t('products.manualDeliveryHint')">
        <select v-model="form.delivery_type" class="select select-bordered w-full">
          <option value="auto">{{ t('products.autoDelivery') }}</option>
          <option value="manual">{{ t('products.manualDelivery') }}</option>
        </select>
      </FormField>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FormField :label="t('products.minQty')">
          <input v-model.number="form.min_qty" type="number" min="1" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('products.maxQty')">
          <input v-model.number="form.max_qty" type="number" min="1" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('products.cost')">
          <input v-model.number="form.cost" type="number" step="0.01" min="0" class="input input-bordered w-full" />
        </FormField>
      </div>

      <FormField :label="t('products.wholesale')">
        <div class="w-full space-y-2">
          <div v-for="(tier, idx) in form.wholesale" :key="idx" class="flex flex-wrap items-center gap-2">
            <input v-model.number="tier.min_qty" type="number" min="2" class="input input-bordered w-28" />
            <input v-model.number="tier.discount" type="number" min="1" max="99" class="input input-bordered w-28" />
            <span class="text-sm opacity-60">%</span>
            <button class="btn btn-ghost btn-error btn-sm" @click="removeWholesale(idx)">
              {{ t('site.delete') }}
            </button>
          </div>
          <button class="btn btn-outline btn-primary btn-sm" @click="addWholesale">
            {{ t('products.addWholesale') }}
          </button>
        </div>
      </FormField>

      <FormField :label="t('products.description')">
        <MdEditor v-model="form.description" :language="editorLang" :preview="false" class="w-full" style="height: 420px" />
      </FormField>

      <FormField :label="t('products.faq')">
        <div class="w-full space-y-3">
          <div v-for="(item, idx) in form.faq" :key="idx" class="space-y-2 rounded-lg bg-base-200/60 p-3">
            <input v-model="item.q" class="input input-bordered w-full" :placeholder="t('products.faqQ')" />
            <textarea v-model="item.a" class="textarea textarea-bordered w-full" rows="2" :placeholder="t('products.faqA')" />
            <button class="btn btn-ghost btn-error btn-sm" @click="removeFaq(idx)">{{ t('site.delete') }}</button>
          </div>
          <button class="btn btn-outline btn-primary btn-sm" @click="addFaq">{{ t('products.addFaq') }}</button>
        </div>
      </FormField>

      <FormField :label="t('products.imageUrl')" :hint="t('products.imageUrlPlaceholder')">
        <input v-model="form.image_url" class="input input-bordered w-full" />
        <div class="mt-2 h-32 w-32 border border-base-300 bg-base-200 p-1">
          <ProductImage :src="form.image_url" :fallback="DEFAULT_IMAGE" />
        </div>
      </FormField>

      <FormField :label="t('products.categoryPlaceholder')">
        <input v-model="form.category" class="input input-bordered w-full" />
      </FormField>

      <FormField :label="t('products.sort')">
        <input v-model.number="form.sort_order" type="number" min="0" class="input input-bordered w-full" />
      </FormField>

      <div class="flex items-center gap-6">
        <label class="flex cursor-pointer items-center gap-2">
          <input v-model="pinned" type="checkbox" class="checkbox checkbox-primary checkbox-sm" />
          <span class="text-sm">{{ t('products.pinned') }}</span>
        </label>
        <label class="flex cursor-pointer items-center gap-2">
          <input v-model="active" type="checkbox" class="checkbox checkbox-primary checkbox-sm" />
          <span class="text-sm">{{ t('products.onSale') }}</span>
        </label>
      </div>

      <div class="flex items-center gap-2 pt-2">
        <button class="btn btn-primary" :class="{ 'btn-disabled': saving }" @click="save">
          <span v-if="saving" class="loading loading-spinner loading-xs"></span>
          {{ t('common.save') }}
        </button>
        <button class="btn btn-ghost" @click="$router.back()">{{ t('common.back') }}</button>
      </div>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { api } from '@/api'
import PageCard from '@/components/PageCard.vue'
import FormField from '@/components/ui/FormField.vue'
import ProductImage from '@/components/ui/ProductImage.vue'
import { toastError, toastSuccess, toastWarning } from '@/components/ui/toast'

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
