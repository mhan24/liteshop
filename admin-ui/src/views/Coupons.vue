<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-3">
      <h2 class="text-xl font-bold">{{ t('coupons.title') }}</h2>
      <Button size="sm" @click="openCreate">{{ t('coupons.add') }}</Button>
    </div>

    <Card>
      <CardContent class="p-0">
        <DataTable :columns="columns" :rows="coupons" :loading="loading" :empty-text="t('audit.empty')">
          <template #type="{ row }">{{ row.type === 'percent' ? '%' : t('coupons.fixed') }}</template>
          <template #value="{ row }">
            <span v-if="row.type === 'percent'">{{ row.percent }}%</span>
            <span v-else>{{ fmtMoney(row.value_cents) }}</span>
          </template>
          <template #minAmount="{ row }">{{ row.min_amount_cents ? fmtMoney(row.min_amount_cents) : '-' }}</template>
          <template #usage="{ row }">{{ row.used_count }}/{{ row.max_uses || '∞' }}</template>
          <template #status="{ row }">
            <Badge :class="row.active ? 'bg-emerald-500/15 text-emerald-700' : 'bg-muted text-muted-foreground'">
              {{ row.active ? t('common.yes') : t('common.no') }}
            </Badge>
          </template>
          <template #expires="{ row }">{{ row.expires_at ? fmtDate(row.expires_at) : '∞' }}</template>
          <template #actions="{ row }">
            <div class="flex items-center gap-1">
              <Button variant="ghost" size="sm" class="h-7 px-2" @click="openEdit(row)">
                {{ t('common.edit') }}
              </Button>
              <Button variant="ghost" size="sm" class="h-7 px-2 text-destructive" @click="remove(row)">
                {{ t('common.delete') }}
              </Button>
            </div>
          </template>
        </DataTable>
      </CardContent>
    </Card>

    <Modal :open="dialog" :title="editing ? t('coupons.edit') : t('coupons.add')" @close="dialog = false">
      <div class="space-y-4">
        <FormField :label="t('coupons.code')">
          <Input v-model="form.code" :disabled="!!editing" />
        </FormField>
        <div class="grid grid-cols-2 gap-4">
          <FormField :label="t('coupons.type')">
            <Select v-model="form.type">
              <SelectTrigger class="w-full">
                <SelectValue :placeholder="t('coupons.type')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">{{ t('coupons.fixed') }}</SelectItem>
                <SelectItem value="percent">%</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField :label="t('coupons.valueLabel')">
            <Input
              v-if="form.type === 'percent'"
              v-model.number="form.percent"
              type="number"
              min="1"
              max="100"
            />
            <Input v-else v-model.number="form.value" type="number" step="0.01" min="0.01" />
          </FormField>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <FormField :label="t('coupons.minAmountLabel')">
            <Input v-model.number="form.min_amount" type="number" step="0.01" min="0" />
          </FormField>
          <FormField :label="t('coupons.maxUses')">
            <Input v-model.number="form.max_uses" type="number" min="0" />
          </FormField>
        </div>
        <FormField :label="t('coupons.productFilter')">
          <Select v-model="productFilter">
            <SelectTrigger class="w-full">
              <SelectValue :placeholder="t('coupons.productFilter')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{{ t('orders.allStatus') }}</SelectItem>
              <SelectItem v-for="p in products" :key="p.id" :value="String(p.id)">
                {{ p.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField :label="t('coupons.expiresLabel')">
          <Input v-model="expiresLocal" type="datetime-local" />
        </FormField>
        <div class="flex items-center gap-2">
          <Checkbox id="coupon-active" :checked="form.active" @update:checked="form.active = $event" />
          <Label for="coupon-active" class="text-sm">{{ t('coupons.active') }}</Label>
        </div>
      </div>
      <template #footer>
        <Button variant="outline" @click="dialog = false">{{ t('common.cancel') }}</Button>
        <Button :disabled="saving" @click="save">
          <Loader2 v-if="saving" class="animate-spin" />
          {{ t('common.save') }}
        </Button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { api } from '@/api'
import { fmtMoney, fmtDate } from '@/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DataTable, { type DataColumn } from '@/components/ui/DataTable.vue'
import Modal from '@/components/ui/Modal.vue'
import FormField from '@/components/ui/FormField.vue'
import { confirm } from '@/components/ui/confirm'
import { toastError, toastSuccess } from '@/components/ui/toast'

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const dialog = ref(false)
const editing = ref<number | null>(null)
const coupons = ref<any[]>([])
const products = ref<any[]>([])
const expiresLocal = ref('')
const productFilter = ref('all')
const form = reactive({
  code: '',
  type: 'fixed',
  value: 0.01,
  percent: 10,
  min_amount: 0,
  max_uses: 0,
  product_id: undefined as number | undefined,
  expires_at: undefined as number | undefined,
  active: true,
})

const columns = computed<DataColumn[]>(() => [
  { key: 'code', label: t('coupons.code'), width: '140px' },
  { slot: 'type', label: t('coupons.type'), width: '90px' },
  { slot: 'value', label: t('coupons.value'), width: '120px' },
  { slot: 'minAmount', label: t('coupons.minAmount'), width: '120px' },
  { slot: 'usage', label: t('coupons.usage'), width: '100px' },
  { slot: 'status', label: t('common.status'), width: '90px' },
  { slot: 'expires', label: t('coupons.expires'), width: '160px' },
  { slot: 'actions', label: t('common.actions'), width: '150px' },
])

function toLocal(sec: number | undefined): string {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocal(v: string): number {
  if (!v) return 0
  const ms = new Date(v).getTime()
  return isNaN(ms) ? 0 : Math.floor(ms / 1000)
}

async function load() {
  loading.value = true
  try {
    coupons.value = (await api.get('/admin/coupons')).coupons || []
    products.value = (await api.get('/admin/products')).products || []
  } finally {
    loading.value = false
  }
}
function openCreate() {
  editing.value = null
  Object.assign(form, {
    code: '',
    type: 'fixed',
    value: 0.01,
    percent: 10,
    min_amount: 0,
    max_uses: 0,
    product_id: undefined,
    expires_at: undefined,
    active: true,
  })
  expiresLocal.value = ''
  productFilter.value = 'all'
  dialog.value = true
}
function openEdit(row: any) {
  editing.value = row.id
  Object.assign(form, {
    code: row.code,
    type: row.type,
    value: (row.value_cents || 0) / 100,
    percent: row.percent,
    min_amount: (row.min_amount_cents || 0) / 100,
    max_uses: row.max_uses,
    product_id: row.product_id || undefined,
    expires_at: row.expires_at || undefined,
    active: row.active,
  })
  expiresLocal.value = toLocal(row.expires_at)
  productFilter.value = row.product_id ? String(row.product_id) : 'all'
  dialog.value = true
}
async function save() {
  saving.value = true
  try {
    const payload: any = {
      code: form.code,
      type: form.type,
      percent: form.percent,
      value_cents: Math.round(form.value * 100),
      min_amount_cents: Math.round(form.min_amount * 100),
      max_uses: form.max_uses,
      product_id: productFilter.value === 'all' ? 0 : Number(productFilter.value),
      expires_at: fromLocal(expiresLocal.value),
      active: form.active,
    }
    if (editing.value) await api.post('/admin/coupons/' + editing.value + '/edit', payload)
    else await api.post('/admin/coupons', payload)
    toastSuccess(t('common.save'))
    dialog.value = false
    await load()
  } catch (e: any) {
    toastError(e.message)
  } finally {
    saving.value = false
  }
}
async function remove(row: any) {
  const ok = await confirm({ title: t('common.prompt'), message: t('coupons.deleteConfirm'), danger: true })
  if (!ok) return
  try {
    await api.post('/admin/coupons/' + row.id + '/delete', {})
    await load()
  } catch (e: any) {
    toastError(e.message || '')
  }
}
onMounted(load)
</script>
