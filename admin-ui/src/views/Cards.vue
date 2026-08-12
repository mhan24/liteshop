<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-3">
      <h2 class="text-xl font-bold">{{ t('cards.title') }}</h2>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="exportCsv">{{ t('cards.export') }}</Button>
        <Button variant="ghost" size="sm" @click="$router.push('/products')">{{ t('cards.back') }}</Button>
      </div>
    </div>

    <Card>
      <CardHeader>
        <CardTitle class="text-base">{{ t('cards.import') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <Textarea v-model="cardsText" class="font-mono" rows="6" placeholder="CARD-001&#10;CARD-002" />
        <div class="flex items-center gap-2">
          <Checkbox id="dedupe" :model-value="dedupe" @update:model-value="dedupe = $event === true" />
          <Label for="dedupe" class="text-sm">{{ t('cards.dedupe') }}</Label>
        </div>
        <Button size="sm" :disabled="importing" @click="importCards">
          <Loader2 v-if="importing" class="animate-spin" />
          {{ t('cards.importBtn') }}
        </Button>
      </CardContent>
    </Card>

    <Card class="mt-4">
      <CardContent class="p-0">
        <DataTable :columns="columns" :rows="cards" :loading="loading" :empty-text="t('audit.empty')">
          <template #status="{ row }">
            <Badge :class="statusBadgeClass(row.status)">{{ statusText(row.status) }}</Badge>
          </template>
          <template #reservedOrder="{ row }">{{ row.reserved_order || '-' }}</template>
          <template #soldOrder="{ row }">{{ row.sold_order || '-' }}</template>
          <template #createdAt="{ row }">{{ date(row.created_at) }}</template>
          <template #soldAt="{ row }">{{ date(row.sold_at) }}</template>
          <template #actions="{ row }">
            <DropdownMenu v-if="canManage(row)">
              <DropdownMenuTrigger as-child>
                <Button variant="outline" size="sm" class="h-7 px-2">
                  {{ t('common.actions') }}
                  <ChevronDown class="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-44">
                <DropdownMenuItem v-if="row.status !== 'available'" @select="onAction(row, 'available')">
                  {{ t('cards.markAvailable') }}
                </DropdownMenuItem>
                <DropdownMenuItem v-if="row.status !== 'locked'" @select="onAction(row, 'locked')">
                  {{ t('cards.markLocked') }}
                </DropdownMenuItem>
                <DropdownMenuItem v-if="row.status !== 'sold'" @select="onAction(row, 'sold')">
                  {{ t('cards.markSold') }}
                </DropdownMenuItem>
                <DropdownMenuItem v-if="row.status !== 'disabled'" @select="onAction(row, 'disabled')">
                  {{ t('cards.markDisabled') }}
                </DropdownMenuItem>
                <DropdownMenuSeparator v-if="row.status === 'available'" />
                <DropdownMenuItem
                  v-if="row.status === 'available'"
                  class="text-destructive"
                  @select="onAction(row, 'delete')"
                >
                  {{ t('common.delete') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <span v-else class="text-sm text-muted-foreground">{{ t('cards.orderBound') }}</span>
          </template>
        </DataTable>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Loader2 } from '@lucide/vue'
import { api } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import DataTable, { type DataColumn } from '@/components/DataTable.vue'
import { statusBadgeClass } from '@/utils/status'
import { confirm } from '@/components/confirm'
import { toastError, toastSuccess } from '@/components/toast'

const route = useRoute()
const { t } = useI18n()
const loading = ref(false)
const importing = ref(false)
const cards = ref<any[]>([])
const cardsText = ref('')
const dedupe = ref(false)

const columns = computed<DataColumn[]>(() => [
  { key: 'id', label: t('common.id'), width: '80px' },
  { key: 'content', label: t('cards.content') },
  { slot: 'status', label: t('common.status'), width: '100px' },
  { slot: 'reservedOrder', label: t('cards.reservedOrder'), width: '120px' },
  { slot: 'soldOrder', label: t('cards.soldOrder'), width: '120px' },
  { slot: 'createdAt', label: t('cards.createdAt'), width: '170px' },
  { slot: 'soldAt', label: t('cards.soldAt'), width: '170px' },
  { slot: 'actions', label: t('common.actions'), width: '130px' },
])

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
    const res = await api.post('/admin/products/' + route.params.id + '/cards', {
      cards: cardsText.value,
      dedupe: dedupe.value,
    })
    const msg = dedupe.value
      ? `${t('cards.added')}: ${res.added}, ${t('cards.skipped')}: ${res.skipped}`
      : `${t('cards.imported')}: ${res.added}`
    toastSuccess(msg)
    cardsText.value = ''
    await load()
  } catch (e: any) {
    toastError(e.message)
  } finally {
    importing.value = false
  }
}
function exportCsv() {
  window.location.href = '/api/v1/admin/products/' + route.params.id + '/cards/export'
}
async function remove(id: number) {
  const ok = await confirm({ title: t('common.prompt'), message: t('cards.deleteConfirm'), danger: true })
  if (!ok) return
  await api.post('/admin/cards/' + id + '/delete', {})
  await load()
}
async function onAction(row: any, cmd: string) {
  if (cmd === 'delete') {
    await remove(row.id)
    return
  }
  const ok = await confirm({
    title: t('common.prompt'),
    message: t('cards.statusConfirm').replace('{status}', statusText(cmd)),
    danger: true,
  })
  if (!ok) return
  try {
    await api.post('/admin/cards/' + row.id + '/status', { status: cmd })
    toastSuccess(t('cards.statusSaved'))
    await load()
  } catch (e: any) {
    toastError(e.message || t('cards.statusFail'))
  }
}
function canManage(row: any) {
  return !row.reserved_order && !row.sold_order
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
