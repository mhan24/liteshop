<template>
  <a-spin :spinning="loading">
    <div class="row">
      <a-typography-title :level="4">卡密管理</a-typography-title>
      <a-button @click="$router.push('/admin/products')">返回商品</a-button>
    </div>
    <a-card title="导入卡密">
      <a-textarea v-model:value="cardsText" :rows="6" placeholder="CARD-001&#10;CARD-002" />
      <a-button type="primary" style="margin-top:12px" :loading="importing" @click="importCards">导入</a-button>
    </a-card>
    <a-table style="margin-top:16px" :data-source="cards" row-key="id" size="small">
      <a-table-column title="ID" data-index="id" />
      <a-table-column title="内容" data-index="content" />
      <a-table-column title="状态">
        <template #default="{ record }">{{ statusText(record.status) }}</template>
      </a-table-column>
      <a-table-column title="操作">
        <template #default="{ record }">
          <a-popconfirm v-if="record.status === 'available'" title="确定删除？" @confirm="remove(record.id)">
            <a-button size="small" danger>删除</a-button>
          </a-popconfirm>
        </template>
      </a-table-column>
    </a-table>
  </a-spin>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { api } from '@/api'

const route = useRoute()
const loading = ref(false)
const importing = ref(false)
const cards = ref([])
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
    message.success('已导入')
    cardsText.value = ''
    await load()
  } catch (e) {
    message.error(e.message)
  } finally {
    importing.value = false
  }
}
async function remove(id) {
  await api.post('/admin/cards/' + id + '/delete', {})
  await load()
}
onMounted(load)
function statusText(status) {
  return { available: '可用', reserved: '已锁定', sold: '已售出' }[status] || status
}
</script>
<style scoped>
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
</style>
