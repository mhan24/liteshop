<template>
  <a-spin :spinning="loading">
    <a-typography-title :level="4">{{ isEdit ? '编辑商品' : '新建商品' }}</a-typography-title>
    <a-form layout="vertical" :model="form" @finish="save" style="max-width:560px">
      <a-form-item label="商品名称" name="name" :rules="[{ required: true, message: '请输入商品名称' }]">
        <a-input v-model:value="form.name" />
      </a-form-item>
      <a-form-item label="价格（CNY）" name="price" :rules="[{ required: true, type: 'number', min: 0.01, message: '请输入有效价格' }]">
        <a-input-number v-model:value="form.price" :min="0.01" style="width:100%" />
      </a-form-item>
      <a-form-item label="描述"><a-textarea v-model:value="form.description" :rows="4" /></a-form-item>
      <a-form-item label="分类（留空归入默认分类）"><a-input v-model:value="form.category" /></a-form-item>
      <a-form-item label="排序值（越小越靠前）"><a-input-number v-model:value="form.sort_order" :min="0" style="width:100%" /></a-form-item>
      <a-form-item><a-checkbox v-model:checked="pinned">置顶显示</a-checkbox></a-form-item>
      <a-form-item><a-checkbox v-model:checked="active">上架销售</a-checkbox></a-form-item>
      <a-space>
        <a-button type="primary" html-type="submit" :loading="saving">保存</a-button>
        <a-button @click="$router.back()">返回</a-button>
      </a-space>
    </a-form>
  </a-spin>
</template>

<script setup>
import { reactive, ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { api } from '@/api'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const isEdit = computed(() => !!route.params.id)
const pinned = ref(false)
const active = ref(true)
const form = reactive({ name: '', price: 0.01, description: '', category: '', sort_order: 0 })

async function load() {
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
}
async function save() {
  saving.value = true
  try {
    const payload = {
      name: form.name,
      description: form.description,
      category: form.category,
      sort_order: form.sort_order,
      price: form.price,
      is_pinned: pinned.value,
      status: active.value ? 'active' : 'disabled',
    }
    if (isEdit.value) await api.post('/admin/products/' + route.params.id + '/edit', payload)
    else await api.post('/admin/products', payload)
    message.success('已保存')
    router.push('/admin/products')
  } catch (e) {
    message.error(e.message)
  } finally {
    saving.value = false
  }
}
onMounted(load)
</script>
