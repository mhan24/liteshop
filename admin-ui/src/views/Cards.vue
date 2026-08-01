<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2>卡密管理</h2>
      <el-button @click="$router.push('/products')">返回商品</el-button>
    </div>
    <el-card header="导入卡密">
      <el-input v-model="cardsText" type="textarea" :rows="6" placeholder="CARD-001&#10;CARD-002" />
      <el-button type="primary" style="margin-top:12px" :loading="importing" @click="importCards">导入</el-button>
    </el-card>
    <el-table :data="cards" style="margin-top:16px" v-loading="loading" size="large">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="content" label="内容" />
      <el-table-column label="状态">
        <template #default="{ row }">{{ statusText(row.status) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="100">
        <template #default="{ row }">
          <el-button v-if="row.status === 'available'" size="small" type="danger" @click="remove(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/api'

const route = useRoute()
const loading = ref(false)
const importing = ref(false)
const cards = ref<any[]>([])
const cardsText = ref('')

async function load() {
  loading.value = true
  try {
    cards.value = (await api.get('/admin/products/' + route.params.id + '/cards')).cards || []
  } finally {
    loading.value = false
  }
}
async function importCards() {
  importing.value = true
  try {
    await api.post('/admin/products/' + route.params.id + '/cards', { cards: cardsText.value })
    ElMessage.success('已导入')
    cardsText.value = ''
    await load()
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    importing.value = false
  }
}
async function remove(id: number) {
  await ElMessageBox.confirm('确定删除该可用卡密吗？', '提示', { type: 'warning' })
  await api.post('/admin/cards/' + id + '/delete', {})
  await load()
}
function statusText(status: string) {
  return { available: '可用', reserved: '已锁定', sold: '已售出' }[status] || status
}
onMounted(load)
</script>
