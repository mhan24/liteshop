<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2>{{ t('coupons.title') }}</h2>
      <el-button type="primary" @click="openCreate">{{ t('coupons.add') }}</el-button>
    </div>
    <el-table :data="coupons" v-loading="loading" size="large">
      <el-table-column prop="code" :label="t('coupons.code')" width="140" />
      <el-table-column :label="t('coupons.type')" width="90">
        <template #default="{ row }">{{ row.type === 'percent' ? '%' : t('coupons.fixed') }}</template>
      </el-table-column>
      <el-table-column :label="t('coupons.value')" width="120">
        <template #default="{ row }">
          <span v-if="row.type === 'percent'">{{ row.percent }}%</span>
          <span v-else>{{ fmtMoney(row.value_cents) }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('coupons.minAmount')" width="120">
        <template #default="{ row }">{{ row.min_amount_cents ? fmtMoney(row.min_amount_cents) : '-' }}</template>
      </el-table-column>
      <el-table-column :label="t('coupons.usage')" width="100">
        <template #default="{ row }">{{ row.used_count }}/{{ row.max_uses || '∞' }}</template>
      </el-table-column>
      <el-table-column :label="t('common.status')" width="90">
        <template #default="{ row }">
          <el-tag :type="row.active ? 'success' : 'info'" size="small">{{ row.active ? t('common.yes') : t('common.no') }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('coupons.expires')" width="160">
        <template #default="{ row }">{{ row.expires_at ? fmtDate(row.expires_at) : '∞' }}</template>
      </el-table-column>
      <el-table-column :label="t('common.actions')" width="150">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">{{ t('common.edit') }}</el-button>
          <el-button size="small" type="danger" text @click="remove(row)">{{ t('common.delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialog" :title="editing ? t('coupons.edit') : t('coupons.add')" width="480px">
      <el-form label-position="top">
        <el-form-item :label="t('coupons.code')"><el-input v-model="form.code" :disabled="!!editing" /></el-form-item>
        <el-row :gutter="12">
          <el-col :md="12">
            <el-form-item :label="t('coupons.type')">
              <el-select v-model="form.type" style="width:100%">
                <el-option :label="t('coupons.fixed')" value="fixed" />
                <el-option label="%" value="percent" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :md="12">
            <el-form-item :label="t('coupons.valueLabel')">
              <el-input-number v-if="form.type === 'percent'" v-model="form.percent" :min="1" :max="100" style="width:100%" />
              <el-input-number v-else v-model="form.value" :min="0.01" :precision="2" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :md="12">
            <el-form-item :label="t('coupons.minAmountLabel')">
              <el-input-number v-model="form.min_amount" :min="0" :precision="2" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :md="12">
            <el-form-item :label="t('coupons.maxUses')">
              <el-input-number v-model="form.max_uses" :min="0" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item :label="t('coupons.productFilter')">
          <el-select v-model="form.product_id" clearable style="width:100%">
            <el-option v-for="p in products" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('coupons.expiresLabel')">
          <el-date-picker v-model="form.expires_at" type="datetime" value-format="timestamp" style="width:100%" />
        </el-form-item>
        <el-checkbox v-model="form.active">{{ t('coupons.active') }}</el-checkbox>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/api'
import { fmtMoney, fmtDate } from '@/utils/format'

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const dialog = ref(false)
const editing = ref<number | null>(null)
const coupons = ref<any[]>([])
const products = ref<any[]>([])
const form = reactive({
  code: '', type: 'fixed', value: 0.01, percent: 10,
  min_amount: 0, max_uses: 0, product_id: undefined as number | undefined,
  expires_at: undefined as number | undefined, active: true,
})

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
  Object.assign(form, { code: '', type: 'fixed', value: 0.01, percent: 10, min_amount: 0, max_uses: 0, product_id: undefined, expires_at: undefined, active: true })
  dialog.value = true
}
function openEdit(row: any) {
  editing.value = row.id
  Object.assign(form, {
    code: row.code, type: row.type, value: (row.value_cents || 0) / 100, percent: row.percent,
    min_amount: (row.min_amount_cents || 0) / 100, max_uses: row.max_uses,
    product_id: row.product_id || undefined, expires_at: row.expires_at || undefined, active: row.active,
  })
  dialog.value = true
}
async function save() {
  saving.value = true
  try {
    const payload: any = {
      code: form.code, type: form.type, percent: form.percent,
      value_cents: Math.round(form.value * 100),
      min_amount_cents: Math.round(form.min_amount * 100),
      max_uses: form.max_uses, product_id: form.product_id || 0,
      expires_at: form.expires_at || 0, active: form.active,
    }
    if (editing.value) await api.post('/admin/coupons/' + editing.value + '/edit', payload)
    else await api.post('/admin/coupons', payload)
    ElMessage.success(t('common.save'))
    dialog.value = false
    await load()
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}
async function remove(row: any) {
  try {
    await ElMessageBox.confirm(t('coupons.deleteConfirm'), t('common.prompt'), { type: 'warning' })
    await api.post('/admin/coupons/' + row.id + '/delete', {})
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.message || '')
  }
}
onMounted(load)
</script>
