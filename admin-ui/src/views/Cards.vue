<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2>{{ t('cards.title') }}</h2>
      <el-button @click="$router.push('/products')">{{ t('cards.back') }}</el-button>
    </div>
    <el-card :header="t('cards.import')">
      <el-input v-model="cardsText" type="textarea" :rows="6" placeholder="CARD-001&#10;CARD-002" />
      <el-button type="primary" style="margin-top:12px" :loading="importing" @click="importCards">{{ t('cards.importBtn') }}</el-button>
    </el-card>
    <el-table :data="cards" style="margin-top:16px" v-loading="loading" size="large">
      <el-table-column prop="id" :label="t('common.id')" width="80" />
      <el-table-column prop="content" :label="t('cards.content')" />
      <el-table-column :label="t('common.status')">
        <template #default="{ row }">{{ statusText(row.status) }}</template>
      </el-table-column>
      <el-table-column :label="t('cards.reservedOrder')">
        <template #default="{ row }">{{ row.reserved_order || '-' }}</template>
      </el-table-column>
      <el-table-column :label="t('cards.soldOrder')">
        <template #default="{ row }">{{ row.sold_order || '-' }}</template>
      </el-table-column>
      <el-table-column :label="t('cards.createdAt')">
        <template #default="{ row }">{{ date(row.created_at) }}</template>
      </el-table-column>
      <el-table-column :label="t('cards.soldAt')">
        <template #default="{ row }">{{ date(row.sold_at) }}</template>
      </el-table-column>
      <el-table-column :label="t('common.actions')" width="100">
        <template #default="{ row }">
          <el-button v-if="row.status === 'available'" size="small" type="danger" @click="remove(row.id)">{{ t('common.delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/api'

const route = useRoute()
const { t } = useI18n()
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
    ElMessage.success(t('cards.imported'))
    cardsText.value = ''
    await load()
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    importing.value = false
  }
}
async function remove(id: number) {
  await ElMessageBox.confirm(t('cards.deleteConfirm'), t('common.prompt'), { type: 'warning' })
  await api.post('/admin/cards/' + id + '/delete', {})
  await load()
}
function statusText(status: string) {
  return (t(`cards.status.${status}`) as string) || status
}
function date(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}
onMounted(load)
</script>
