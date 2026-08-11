<template>
  <div>
    <div class="mb-4 flex items-center justify-between gap-3">
      <h2 class="text-xl font-bold">{{ t('admins.title') }}</h2>
      <Button size="sm" @click="dialog = true">{{ t('admins.add') }}</Button>
    </div>

    <Card>
      <CardContent class="p-0">
        <DataTable :columns="columns" :rows="admins" :loading="loading" :empty-text="t('audit.empty')">
          <template #role="{ row }">
            <Badge
              :class="{
                'bg-red-500/15 text-red-700': row.role === 'admin',
                'bg-amber-500/15 text-amber-700': row.role === 'operator',
                'bg-muted text-muted-foreground': row.role === 'viewer',
              }"
            >
              {{ roleText(row.role) }}
            </Badge>
          </template>
          <template #createdAt="{ row }">{{ fmtDate(row.created_at) }}</template>
          <template #actions="{ row }">
            <div class="flex items-center gap-2">
              <Select :model-value="row.role" @update:model-value="(v: string) => setRole(row, v)">
                <SelectTrigger class="w-28 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="(label, key) in roleOptions" :key="key" :value="key">
                    {{ label }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                class="h-8 px-2 text-destructive"
                :disabled="row.id === currentId"
                @click="remove(row)"
              >
                {{ t('admins.delete') }}
              </Button>
            </div>
          </template>
        </DataTable>
      </CardContent>
    </Card>

    <Modal :open="dialog" :title="t('admins.add')" @close="dialog = false">
      <div class="space-y-4">
        <FormField :label="t('admins.username')">
          <Input v-model="form.username" />
        </FormField>
        <FormField :label="t('admins.password')">
          <Input v-model="form.password" type="password" />
        </FormField>
        <FormField :label="t('admins.role')">
          <Select v-model="form.role">
            <SelectTrigger class="w-full">
              <SelectValue :placeholder="t('admins.role')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="(label, key) in roleOptions" :key="key" :value="key">
                {{ label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <template #footer>
        <Button variant="outline" @click="dialog = false">{{ t('common.cancel') }}</Button>
        <Button :disabled="saving" @click="create">
          <Loader2 v-if="saving" class="animate-spin" />
          {{ t('common.confirm') }}
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
import { fmtDate } from '@/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import DataTable, { type DataColumn } from '@/components/DataTable.vue'
import Modal from '@/components/Modal.vue'
import FormField from '@/components/FormField.vue'
import { confirm } from '@/components/confirm'
import { toastError, toastSuccess } from '@/components/toast'

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
