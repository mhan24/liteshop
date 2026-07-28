<template>
  <a-spin :spinning="loading">
    <div class="row">
      <a-typography-title :level="4">商品管理</a-typography-title>
      <a-button type="primary" @click="$router.push('/admin/products/new')">新建商品</a-button>
    </div>
    <a-table :data-source="products" row-key="id" :pagination="{ pageSize: 20 }">
      <a-table-column title="ID" data-index="id" />
      <a-table-column title="名称" data-index="name" />
      <a-table-column title="分类">
        <template #default="{ record }">{{ record.category || '默认分类' }}</template>
      </a-table-column>
      <a-table-column title="价格">
        <template #default="{ record }">{{ (record.price_cents / 100).toFixed(2) }}</template>
      </a-table-column>
      <a-table-column title="库存" data-index="available" />
      <a-table-column title="操作">
        <template #default="{ record }">
          <a-button size="small" @click="$router.push('/admin/products/' + record.id + '/edit')">编辑</a-button>
          <a-button size="small" @click="$router.push('/admin/products/' + record.id + '/cards')">卡密</a-button>
        </template>
      </a-table-column>
    </a-table>
  </a-spin>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '@/api'
const loading = ref(false)
const products = ref([])
async function load() {
  loading.value = true
  try {
    products.value = (await api.get('/admin/products')).products || []
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
<style scoped>
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
</style>
