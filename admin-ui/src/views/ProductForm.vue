<template>
  <el-card>
    <template #header><h2>{{ isEdit ? '编辑商品' : '新建商品' }}</h2></template>
    <el-form ref="formRef" :model="form" label-position="top" style="max-width:560px" v-loading="loading">
      <el-form-item label="商品名称" prop="name" :rules="[{ required: true, message: '请输入商品名称' }]">
        <el-input v-model="form.name" />
      </el-form-item>
      <el-form-item label="价格（CNY）" prop="price" :rules="[{ required: true, message: '请输入价格' }]">
        <el-input-number v-model="form.price" :min="0.01" :precision="2" />
      </el-form-item>
      <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="4" /></el-form-item>
      <el-form-item label="分类（留空归入默认分类）"><el-input v-model="form.category" /></el-form-item>
      <el-form-item label="排序值（越小越靠前）"><el-input-number v-model="form.sort_order" :min="0" /></el-form-item>
      <el-checkbox v-model="pinned">置顶显示</el-checkbox>
      <el-checkbox v-model="active">上架销售</el-checkbox>
      <div style="margin-top:16px">
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        <el-button @click="$router.back()">返回</el-button>
      </div>
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, FormInstance } from 'element-plus'
import { api } from '@/api'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const isEdit = computed(() => !!route.params.id)
const pinned = ref(false)
const active = ref(true)
const form = reactive({ name: '', price: 0.01, description: '', category: '', sort_order: 0 })

onMounted(async () => {
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
      ElMessage.success('已保存')
      router.push('/products')
    } catch (e: any) {
      ElMessage.error(e.message)
    } finally {
      saving.value = false
    }
  })
}
</script>
