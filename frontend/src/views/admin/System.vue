<template>
  <a-typography-title :level="4">系统</a-typography-title>
  <a-card title="配置备份 / 恢复">
    <a-space>
      <a-button type="primary" @click="download">下载配置备份</a-button>
      <a-upload :before-upload="handleUpload" :show-upload-list="false" accept=".json,application/json">
        <a-button>恢复配置</a-button>
      </a-upload>
    </a-space>
  </a-card>
  <a-card title="危险区" style="margin-top:16px; border-color:#ffccc7">
    <a-typography-paragraph type="danger">清空所有数据并重新初始化，不可恢复。</a-typography-paragraph>
    <a-input v-model:value="confirmText" placeholder="DELETE" style="max-width:240px; margin-bottom:12px" />
    <a-button danger :disabled="confirmText !== 'DELETE'" @click="reset">清空所有数据并重新初始化</a-button>
  </a-card>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { api } from '@/api'

const router = useRouter()
const confirmText = ref('')

function download() {
  window.location.href = '/api/v1/admin/system/backup'
}
async function handleUpload(file) {
  const fd = new FormData()
  fd.append('backup_file', file)
  try {
    await api.post('/admin/system/restore', fd)
    message.success('已恢复')
  } catch (e) {
    message.error(e.message)
  }
  return false
}
async function reset() {
  await api.post('/admin/system/reset', { confirm: 'DELETE' })
  router.push('/setup')
}
</script>
