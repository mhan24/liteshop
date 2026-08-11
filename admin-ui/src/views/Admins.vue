<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-3">
      <h2 class="text-xl font-bold">{{ t('admins.title') }}</h2>
      <button class="btn btn-primary btn-sm" @click="dialog = true">{{ t('admins.add') }}</button>
    </div>

    <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
      <div class="card-body !p-0">
        <DataTable :columns="columns" :rows="admins" :loading="loading" :empty-text="t('audit.empty')">
          <template #role="{ row }">
            <span class="badge badge-sm" :class="roleBadgeClass(row.role)">{{ roleText(row.role) }}</span>
          </template>
          <template #createdAt="{ row }">{{ fmtDate(row.created_at) }}</template>
          <template #actions="{ row }">
            <div class="flex items-center gap-2">
              <select
                :model-value="row.role"
                class="select select-bordered select-xs w-28"
                @change="(e: any) => setRole(row, e.target.value)"
              >
                <option v-for="(label, key) in roleOptions" :key="key" :value="key">{{ label }}</option>
              </select>
              <button class="btn btn-ghost btn-error btn-xs" :disabled="row.id === currentId" @click="remove(row)">
                {{ t('admins.delete') }}
              </button>
            </div>
          </template>
        </DataTable>
      </div>
    </div>

    <Modal :open="dialog" :title="t('admins.add')" @close="dialog = false">
      <div class="space-y-4">
        <FormField :label="t('admins.username')">
          <input v-model="form.username" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('admins.password')">
          <input v-model="form.password" type="password" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('admins.role')">
          <select v-model="form.role" class="select select-bordered w-full">
            <option v-for="(label, key) in roleOptions" :key="key" :value="key">{{ label }}</option>
          </select>
        </FormField>
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="dialog = false">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :class="{ 'btn-disabled': saving }" @click="create">
          <span v-if="saving" class="loading loading-spinner loading-xs"></span>
          {{ t('common.confirm') }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'
import { fmtDate } from '@/utils/format'
import DataTable, { type DataColumn } from '@/components/ui/DataTable.vue'
import Modal from '@/components/ui/Modal.vue'
import FormField from '@/components/ui/FormField.vue'
import { confirm } from '@/components/ui/confirm'
import { toastError, toastSuccess } from '@/components/ui/toast'

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const dialog = ref(false)
const admins = ref<any[]>([])
const form = reactive({ username: '', password: '', role: 'operator' })
const currentId = computed(() => 0)

const columns = computed<DataColumn[]>(() => [
  { key: 'id', label: t('common.id'), width: '80px' },
  { key: 'username', label: t('admins.username') },
  { slot: 'role', label: t('admins.role'), width: '140px' },
  { slot: 'createdAt', label: t('admins.createdAt'), width: '170px' },
  { slot: 'actions', label: t('common.actions'), width: '200px' },
])

const roleOptions = computed(() => ({
  admin: t('admins.roleAdmin'),
  operator: t('admins.roleOperator'),
  viewer: t('admins.roleViewer'),
}))
function roleText(role: string) {
  const m: any = { admin: t('admins.roleAdmin'), operator: t('admins.roleOperator'), viewer: t('admins.roleViewer') }
  return m[role] || role
}
function roleBadgeClass(role: string) {
  return { admin: 'badge-error', operator: 'badge-warning', viewer: 'badge-ghost' }[role] || 'badge-ghost'
}
async function load() {
  loading.value = true
  try {
    admins.value = (await api.get('/admin/admins')).admins || []
  } finally {
    loading.value = false
  }
}
async function create() {
  saving.value = true
  try {
    await api.post('/admin/admins', form)
    toastSuccess(t('admins.added'))
    dialog.value = false
    form.username = ''
    form.password = ''
    form.role = 'operator'
    await load()
  } catch (e: any) {
    toastError(e.message)
  } finally {
    saving.value = false
  }
}
async function setRole(row: any, role: string) {
  if (role === row.role) return
  try {
    await api.post('/admin/admins/' + row.id + '/role', { role })
    toastSuccess(t('admins.roleChanged'))
    await load()
  } catch (e: any) {
    toastError(e.message)
    await load()
  }
}
async function remove(row: any) {
  const ok = await confirm({ title: t('common.prompt'), message: t('admins.deleteConfirm'), danger: true })
  if (!ok) return
  try {
    await api.post('/admin/admins/' + row.id + '/delete', {})
    toastSuccess(t('admins.deleted'))
    await load()
  } catch (e: any) {
    toastError(e.message || '')
  }
}
onMounted(load)
</script>
