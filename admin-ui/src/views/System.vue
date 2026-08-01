<template>
  <div>
    <el-card>
      <template #header><h2>配置备份 / 恢复</h2></template>
      <p class="muted">备份站点/支付/通知等配置（不含商品、卡密、订单）。恢复会覆盖同名配置。</p>
      <el-space>
        <el-button type="primary" @click="download">下载配置备份</el-button>
        <el-upload :before-upload="handleUpload" :show-file-list="false" accept=".json,application/json">
          <el-button>恢复配置</el-button>
        </el-upload>
      </el-space>
    </el-card>
    <el-card style="margin-top:16px">
      <template #header><h2 style="color:var(--el-color-danger)">危险区</h2></template>
      <p>清空所有数据并重新初始化，不可恢复。</p>
      <el-input v-model="confirmText" placeholder="DELETE" style="max-width:240px;margin-bottom:12px" />
      <div>
        <el-button type="danger" :disabled="confirmText !== 'DELETE'" @click="reset">清空所有数据并重新初始化</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '@/api'

const router = useRouter()
const confirmText = ref('')

function download() {
  window.location.href = '/api/v1/admin/system/backup'
}
async function handleUpload(file: File) {
  const fd = new FormData()
  fd.append('backup_file', file)
  try {
    await api.post('/admin/system/restore', fd)
    ElMessage.success('已恢复')
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
