<template>
  <el-card v-loading="loading">
    <template #header
      ><h2>{{ isEdit ? t('products.edit') : t('products.new') }}</h2></template
    >
    <el-form ref="formRef" :model="form" label-position="top" style="max-width: 560px">
      <el-form-item
        :label="t('products.name')"
        prop="name"
        :rules="[{ required: true, message: t('products.nameRequired') }]"
      >
        <el-input v-model="form.name" />
      </el-form-item>
      <el-form-item
        :label="t('products.priceCny')"
        prop="price"
        :rules="[{ required: true, message: t('products.priceRequired') }]"
      >
        <el-input-number v-model="form.price" :min="0.01" :precision="2" />
      </el-form-item>
      <el-row :gutter="12">
        <el-col :md="8">
          <el-form-item :label="t('products.minQty')"
            ><el-input-number v-model="form.min_qty" :min="1" style="width: 100%"
          /></el-form-item>
        </el-col>
        <el-col :md="8">
          <el-form-item :label="t('products.maxQty')"
            ><el-input-number v-model="form.max_qty" :min="1" style="width: 100%"
          /></el-form-item>
        </el-col>
        <el-col :md="8">
          <el-form-item :label="t('products.cost')"
            ><el-input-number v-model="form.cost" :min="0" :precision="2" style="width: 100%"
          /></el-form-item>
        </el-col>
      </el-row>
      <el-form-item :label="t('products.wholesale')">
        <div style="width: 100%">
          <div v-for="(tier, idx) in form.wholesale" :key="idx" class="wholesale-row">
            <el-input-number
              v-model="tier.min_qty"
              :min="2"
              :placeholder="t('products.wholesaleMinQty')"
              style="width: 120px"
            />
            <el-input-number
              v-model="tier.discount"
              :min="1"
              :max="99"
              :placeholder="t('products.wholesaleDiscount')"
              style="width: 120px"
            />
            <span class="text-xs text-gray-500">%</span>
            <el-button type="danger" text @click="removeWholesale(idx)">{{ t('site.delete') }}</el-button>
          </div>
          <el-button type="primary" plain @click="addWholesale">{{ t('products.addWholesale') }}</el-button>
        </div>
      </el-form-item>
      <el-form-item :label="t('products.description')">
        <MdEditor
          v-model="form.description"
          :language="editorLang"
          :preview="false"
          style="height: 420px; width: 100%"
        />
      </el-form-item>
      <el-form-item :label="t('products.faq')">
        <div class="faq-list" style="width: 100%">
          <div v-for="(item, idx) in form.faq" :key="idx" class="faq-row">
            <el-input v-model="item.q" :placeholder="t('products.faqQ')" />
            <el-input v-model="item.a" type="textarea" :rows="2" :placeholder="t('products.faqA')" />
            <el-button type="danger" text @click="removeFaq(idx)">{{ t('site.delete') }}</el-button>
          </div>
          <el-button type="primary" plain @click="addFaq">{{ t('products.addFaq') }}</el-button>
        </div>
      </el-form-item>
      <el-form-item :label="t('products.imageUrl')">
        <el-input v-model="form.image_url" :placeholder="t('products.imageUrlPlaceholder')" />
        <el-image
          :src="previewImg"
          fit="contain"
          style="width: 120px; height: 120px; margin-top: 8px; border: 1px solid #eee; border-radius: 8px"
        >
          <template #error>.</template>
        </el-image>
      </el-form-item>
      <el-form-item :label="t('products.categoryPlaceholder')"><el-input v-model="form.category" /></el-form-item>
      <el-form-item :label="t('products.sort')"><el-input-number v-model="form.sort_order" :min="0" /></el-form-item>
      <el-checkbox v-model="pinned">{{ t('products.pinned') }}</el-checkbox>
      <el-checkbox v-model="active">{{ t('products.onSale') }}</el-checkbox>
      <div style="margin-top: 16px">
        <el-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button>
        <el-button @click="$router.back()">{{ t('common.back') }}</el-button>
      </div>
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, FormInstance } from 'element-plus'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { api } from '@/api'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const editorLang = computed(() => (locale.value === 'en' ? 'en-US' : 'zh-CN'))
const loading = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
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
  faq: [] as { q: string; a: string }[],
  min_qty: 1,
  max_qty: 100,
  cost: 0,
  wholesale: [] as { min_qty: number; discount: number }[],
})

const DEFAULT_IMAGE = ref('/default-product.svg')
const previewImg = computed(() => form.image_url.trim() || DEFAULT_IMAGE.value)
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
  if (!formRef.value) return
  await formRef.value.validate(async (ok) => {
    if (!ok) return
    saving.value = true
    try {
      const payload: any = { ...form, is_pinned: pinned.value, status: active.value ? 'active' : 'disabled' }
      payload.price = form.price
      payload.cost_cents = Math.round((form.cost || 0) * 100)
      delete payload.price_cents
      delete payload.cost
      if (isEdit.value) await api.post('/admin/products/' + route.params.id + '/edit', payload)
      else await api.post('/admin/products', payload)
      ElMessage.success(t('products.saveSuccess'))
      router.push('/products')
    } catch (e: any) {
      ElMessage.error(e.message)
    } finally {
      saving.value = false
    }
  })
}
</script>
