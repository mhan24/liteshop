<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2>商品管理</h2>
      <el-button type="primary" @click="$router.push('/products/new')">新建商品</el-button>
    </div>
    <el-table :data="pagedProducts" v-loading="loading" size="large">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="name" label="名称" />
      <el-table-column label="分类">
        <template #default="{ row }">{{ row.category || '默认分类' }}</template>
      </el-table-column>
      <el-table-column label="价格">
        <template #default="{ row }">{{ (row.price_cents / 100).toFixed(2) }}</template>
      </el-table-column>
      <el-table-column prop="available" label="库存" width="80" />
      <el-table-column label="操作" width="180">
        <template #default="{ row }">
          <el-button size="small" @click="$router.push('/products/' + row.id + '/edit')">编辑</el-button>
          <el-button size="small" @click="$router.push('/products/' + row.id + '/cards')">卡密</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div style="display:flex;justify-content:flex-end;margin-top:12px">
      <el-pagination v-if="products.length" background layout="prev, pager, next, total" :total="products.length" :page-size="pageSize" v-model:current-page="currentPage" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'

const products = ref<any[]>([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const pagedProducts = computed(() => products.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

onMounted(async () => {
  loading.value = true
  try {
    products.value = (await api.get('/admin/products')).products || []
  } finally {
    loading.value = false
  }
})
</script>
