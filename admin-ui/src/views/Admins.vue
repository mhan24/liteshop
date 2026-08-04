<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2>{{ t('admins.title') }}</h2>
      <el-button type="primary" @click="dialog = true">{{ t('admins.add') }}</el-button>
    </div>
    <el-table :data="admins" v-loading="loading" size="large">
      <el-table-column prop="id" :label="t('common.id')" width="80" />
      <el-table-column prop="username" :label="t('admins.username')" />
      <el-table-column :label="t('admins.role')" width="140">
        <template #default="{ row }">
          <el-tag :type="roleType(row.role)">{{ roleText(row.role) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('admins.createdAt')" width="170">
        <template #default="{ row }">{{ fmtDate(row.created_at) }}</template>
      </el-table-column>
      <el-table-column :label="t('common.actions')" width="200">
        <template #default="{ row }">
          <el-select
            :model-value="row.role"
            size="small"
            style="width:110px"
            :disabled="row.id === store.username ? false : false"
            @change="(v: string) => setRole(row, v)"
          >
            <el-option v-for="(label, key) in roleOptions" :key="key" :label="label" :value="key" />
          </el-select>
          <el-button size="small" type="danger" text :disabled="row.id === currentId" @click="remove(row)">{{ t('admins.delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialog" :title="t('admins.add')" width="400px">
      <el-form label-position="top">
        <el-form-item :label="t('admins.username')"><el-input v-model="form.username" /></el-form-item>
        <el-form-item :label="t('admins.password')"><el-input v-model="form.password" type="password" show-password /></el-form-item>
        <el-form-item :label="t('admins.role')">
          <el-select v-model="form.role" style="width:100%">
            <el-option v-for="(label, key) in roleOptions" :key="key" :label="label" :value="key" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="create">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/api'
import { fmtDate } from '@/utils/format'
import { useSessionStore } from '@/stores/session'

const { t } = useI18n()
const store = useSessionStore()
const loading = ref(false)
const saving = ref(false)
const dialog = ref(false)
const admins = ref<any[]>([])
const form = reactive({ username: '', password: '', role: 'operator' })
const currentId = computed(() => {
  // 当前登录 id 无法直接拿, 用 username 匹配
  return 0
})

const roleOptions = computed(() => ({
  admin: t('admins.roleAdmin'),
  operator: t('admins.roleOperator'),
  viewer: t('admins.roleViewer'),
}))
function roleText(role: string) {
  const m: any = { admin: t('admins.roleAdmin'), operator: t('admins.roleOperator'), viewer: t('admins.roleViewer') }
  return m[role] || role
}
function roleType(role: string): any {
  return { admin: 'danger', operator: 'warning', viewer: 'info' }[role] || 'info'
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
    ElMessage.success(t('admins.added'))
    dialog.value = false
    form.username = ''
    form.password = ''
    form.role = 'operator'
    await load()
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}
async function setRole(row: any, role: string) {
  if (role === row.role) return
  try {
    await api.post('/admin/admins/' + row.id + '/role', { role })
    ElMessage.success(t('admins.roleChanged'))
    await load()
  } catch (e: any) {
    ElMessage.error(e.message)
    await load()
  }
}
async function remove(row: any) {
  try {
    await ElMessageBox.confirm(t('admins.deleteConfirm'), t('common.prompt'), { type: 'warning' })
    await api.post('/admin/admins/' + row.id + '/delete', {})
    ElMessage.success(t('admins.deleted'))
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.message || '')
  }
}
onMounted(load)
</script>
