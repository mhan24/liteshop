<template>
  <el-card v-loading="loading">
    <template #header><h2>{{ isEdit ? t('products.edit') : t('products.new') }}</h2></template>
    <el-form ref="formRef" :model="form" label-position="top" style="max-width:560px">
      <el-form-item :label="t('products.name')" prop="name" :rules="[{ required: true, message: t('products.nameRequired') }]">
        <el-input v-model="form.name" />
      </el-form-item>
      <el-form-item :label="t('products.priceCny')" prop="price" :rules="[{ required: true, message: t('products.priceRequired') }]">
        <el-input-number v-model="form.price" :min="0.01" :precision="2" />
      </el-form-item>
      <el-form-item :label="t('products.description')">
        <MdEditor v-model="form.description" :language="editorLang" :preview="false" style="height:420px;width:100%" />
      </el-form-item>
      <el-form-item :label="t('products.faq')">
        <div class="faq-list" style="width:100%">
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
        <el-image :src="previewImg" fit="contain" style="width:120px;height:120px;margin-top:8px;border:1px solid #eee;border-radius:8px">
          <template #error>.</template>
        </el-image>
      </el-form-item>
      <el-form-item :label="t('products.categoryPlaceholder')"><el-input v-model="form.category" /></el-form-item>
      <el-form-item :label="t('products.sort')"><el-input-number v-model="form.sort_order" :min="0" /></el-form-item>
      <el-checkbox v-model="pinned">{{ t('products.pinned') }}</el-checkbox>
      <el-checkbox v-model="active">{{ t('products.onSale') }}</el-checkbox>
      <div style="margin-top:16px">
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
const form = reactive({ name: '', price: 0.01, description: '', image_url: '', category: '', sort_order: 0, faq: [] as { q: string; a: string }[] })

const DEFAULT_IMAGE = ref('https://storage.moegirl.org.cn/moegirl/commons/0/0d/%E8%B1%86%E5%8C%85AI.png')
const previewImg = computed(() => form.image_url.trim() || DEFAULT_IMAGE.value)
function addFaq() {
  form.faq.push({ q: '', a: '' })
}
function removeFaq(idx: number) {
  form.faq.splice(idx, 1)
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
      const payload = { ...form, is_pinned: pinned.value, status: active.value ? 'active' : 'disabled' }
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
