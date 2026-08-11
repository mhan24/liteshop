<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-3">
      <h2 class="text-xl font-bold">{{ t('audit.title') }}</h2>
      <Button variant="outline" size="sm" @click="load">{{ t('common.refresh') }}</Button>
    </div>

    <Card>
      <CardContent class="p-0">
        <DataTable :columns="columns" :rows="logs" :loading="loading" :empty-text="t('audit.empty')">
          <template #time="{ row }">{{ fmtDate(row.created_at) }}</template>
          <template #action="{ row }">
            <Badge variant="secondary">{{ actionText(row.action) }}</Badge>
          </template>
          <template #target="{ row }">{{ row.target_type }} {{ row.target_id }}</template>
          <template #before="{ row }"><span class="mono text-xs">{{ row.before || '-' }}</span></template>
          <template #after="{ row }"><span class="mono text-xs">{{ row.after || '-' }}</span></template>
        </DataTable>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'
import { fmtDate } from '@/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import DataTable, { type DataColumn } from '@/components/ui/DataTable.vue'

const { t } = useI18n()
const loading = ref(false)
const logs = ref<any[]>([])

const columns = computed<DataColumn[]>(() => [
  { slot: 'time', label: t('audit.time'), width: '170px' },
  { key: 'username', label: t('audit.who'), width: '140px' },
  { slot: 'action', label: t('audit.action'), width: '150px' },
  { slot: 'target', label: t('audit.target'), width: '180px' },
  { slot: 'before', label: t('audit.before') },
  { slot: 'after', label: t('audit.after') },
])

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
