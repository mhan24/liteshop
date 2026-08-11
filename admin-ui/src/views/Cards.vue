<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-3">
      <h2 class="text-xl font-bold">{{ t('cards.title') }}</h2>
      <div class="flex items-center gap-2">
        <button class="btn btn-outline btn-sm" @click="exportCsv">{{ t('cards.export') }}</button>
        <button class="btn btn-ghost btn-sm" @click="$router.push('/products')">{{ t('cards.back') }}</button>
      </div>
    </div>

    <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
      <div class="card-body">
        <h3 class="font-semibold">{{ t('cards.import') }}</h3>
        <textarea
          v-model="cardsText"
          class="textarea textarea-bordered w-full font-mono"
          rows="6"
          placeholder="CARD-001&#10;CARD-002"
        ></textarea>
        <label class="flex cursor-pointer items-center gap-2">
          <input v-model="dedupe" type="checkbox" class="checkbox checkbox-primary checkbox-sm" />
          <span class="text-sm">{{ t('cards.dedupe') }}</span>
        </label>
        <div>
          <button class="btn btn-primary btn-sm" :class="{ 'btn-disabled': importing }" @click="importCards">
            <span v-if="importing" class="loading loading-spinner loading-xs"></span>
            {{ t('cards.importBtn') }}
          </button>
        </div>
      </div>
    </div>

    <div class="card mt-4 bg-base-100 shadow-sm ring-1 ring-base-300">
      <div class="card-body !p-0">
        <DataTable :columns="columns" :rows="cards" :loading="loading" :empty-text="t('audit.empty')">
          <template #status="{ row }">
            <span class="badge badge-sm" :class="statusBadgeClass(row.status)">{{ statusText(row.status) }}</span>
          </template>
          <template #reservedOrder="{ row }">{{ row.reserved_order || '-' }}</template>
          <template #soldOrder="{ row }">{{ row.sold_order || '-' }}</template>
          <template #createdAt="{ row }">{{ date(row.created_at) }}</template>
          <template #soldAt="{ row }">{{ date(row.sold_at) }}</template>
          <template #actions="{ row }">
            <div v-if="canManage(row)" class="dropdown dropdown-end">
              <div tabindex="0" role="button" class="btn btn-outline btn-primary btn-xs">
                {{ t('common.actions') }}
                <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              <ul tabindex="0" class="menu dropdown-content z-50 mt-1 w-44 rounded-box bg-base-100 p-2 shadow-lg ring-1 ring-base-300">
                <li v-if="row.status !== 'available'">
                  <a @click="onAction(row, 'available')">{{ t('cards.markAvailable') }}</a>
                </li>
                <li v-if="row.status !== 'locked'">
                  <a @click="onAction(row, 'locked')">{{ t('cards.markLocked') }}</a>
                </li>
                <li v-if="row.status !== 'sold'">
                  <a @click="onAction(row, 'sold')">{{ t('cards.markSold') }}</a>
                </li>
                <li v-if="row.status !== 'disabled'">
                  <a @click="onAction(row, 'disabled')">{{ t('cards.markDisabled') }}</a>
                </li>
                <li v-if="row.status === 'available'" class="mt-1 border-t border-base-300 pt-1">
                  <a class="text-error" @click="onAction(row, 'delete')">{{ t('common.delete') }}</a>
                </li>
              </ul>
            </div>
            <span v-else class="text-sm opacity-50">{{ t('cards.orderBound') }}</span>
          </template>
        </DataTable>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'
import DataTable, { type DataColumn } from '@/components/ui/DataTable.vue'
import { statusBadgeClass } from '@/utils/status'
import { confirm } from '@/components/ui/confirm'
import { toastError, toastSuccess } from '@/components/ui/toast'

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
