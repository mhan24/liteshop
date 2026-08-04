<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2>{{ t('audit.title') }}</h2>
      <el-button @click="load">{{ t('common.refresh') }}</el-button>
    </div>
    <el-card>
      <el-table :data="logs" v-loading="loading" size="small">
        <el-table-column :label="t('audit.time')" width="170">
          <template #default="{ row }">{{ fmtDate(row.created_at) }}</template>
        </el-table-column>
        <el-table-column :label="t('audit.who')" width="140">
          <template #default="{ row }">{{ row.username }}</template>
        </el-table-column>
        <el-table-column :label="t('audit.action')" width="150">
          <template #default="{ row }">
            <el-tag size="small">{{ actionText(row.action) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('audit.target')" width="180">
          <template #default="{ row }">{{ row.target_type }} {{ row.target_id }}</template>
        </el-table-column>
        <el-table-column :label="t('audit.before')" min-width="140">
          <template #default="{ row }"><span class="mono">{{ row.before || '-' }}</span></template>
        </el-table-column>
        <el-table-column :label="t('audit.after')" min-width="140">
          <template #default="{ row }"><span class="mono">{{ row.after || '-' }}</span></template>
        </el-table-column>
      </el-table>
      <div v-if="!logs.length && !loading" class="empty-tip">{{ t('audit.empty') }}</div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'
import { fmtDate } from '@/utils/format'

const { t } = useI18n()
const loading = ref(false)
const logs = ref<any[]>([])

const actionMap: Record<string, string> = {
  product_create: 'product_create', product_update: 'product_update',
  cards_import: 'cards_import', card_delete: 'card_delete',
  order_expire: 'order_expire', order_cancel: 'order_cancel',
  order_status: 'order_status', order_redeliver: 'order_redeliver',
  account_update: 'account_update',
  admin_create: 'admin_create', admin_role: 'admin_role', admin_delete: 'admin_delete',
  system_reset: 'system_reset',
}
function actionText(action: string) {
  return (t(`audit.actions.${action}`) as string) || action
}
async function load() {
  loading.value = true
  try {
    logs.value = (await api.get('/admin/audit-logs')).logs || []
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<style scoped>
.mono {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  word-break: break-all;
}
.empty-tip {
  color: #c0c4cc;
  font-size: 13px;
  text-align: center;
  padding: 16px 0;
}
</style>
