<template>
  <div>
    <el-card>
      <template #header><h2>{{ t('system.backup') }}</h2></template>
      <p class="muted">{{ t('system.backupNote') }}</p>
      <el-space>
        <el-button type="primary" @click="download">{{ t('system.downloadBackup') }}</el-button>
        <el-upload :before-upload="handleUpload" :show-file-list="false" accept=".json,application/json">
          <el-button>{{ t('system.restore') }}</el-button>
        </el-upload>
      </el-space>
    </el-card>
    <el-card style="margin-top:16px">
      <template #header><h2 style="color:var(--el-color-danger)">{{ t('system.danger') }}</h2></template>
      <p>{{ t('system.dangerNote') }}</p>
      <el-input v-model="confirmText" :placeholder="t('system.deleteConfirm')" style="max-width:240px;margin-bottom:12px" />
      <div>
        <el-button type="danger" :disabled="confirmText !== 'DELETE'" @click="reset">{{ t('system.reset') }}</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { api } from '@/api'

const router = useRouter()
const { t } = useI18n()
const confirmText = ref('')

function download() {
  window.location.href = '/api/v1/admin/system/backup'
}
async function handleUpload(file: File) {
  const fd = new FormData()
  fd.append('backup_file', file)
  try {
    await api.post('/admin/system/restore', fd)
    ElMessage.success(t('system.restored'))
  } catch (e: any) {
    ElMessage.error(e.message)
  }
  return false
}
async function reset() {
  await api.post('/admin/system/reset', { confirm: 'DELETE' })
  router.push('/login')
}
</script>
