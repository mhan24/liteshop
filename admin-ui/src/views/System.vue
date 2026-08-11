<template>
  <div class="space-y-4">
    <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
      <div class="card-body">
        <h2 class="card-title text-lg">{{ t('system.backup') }}</h2>
        <p class="text-sm opacity-70">{{ t('system.backupNote') }}</p>
        <p class="text-sm font-medium text-warning">{{ t('system.backupWarning') }}</p>
        <div class="flex flex-wrap items-center gap-2">
          <button class="btn btn-primary btn-sm" @click="download">{{ t('system.downloadBackup') }}</button>
          <label class="btn btn-outline btn-sm cursor-pointer">
            <span v-if="restoring" class="loading loading-spinner loading-xs"></span>
            {{ t('system.restore') }}
            <input type="file" class="hidden" accept=".json,application/json" @change="onFileChange" />
          </label>
        </div>
      </div>
    </div>

    <div class="card border border-error/30 bg-base-100 shadow-sm ring-1 ring-error/20">
      <div class="card-body">
        <h2 class="card-title text-lg text-error">{{ t('system.danger') }}</h2>
        <p class="text-sm opacity-70">{{ t('system.dangerNote') }}</p>
        <input
          v-model="confirmText"
          class="input input-bordered input-sm max-w-60"
          :placeholder="t('system.deleteConfirm')"
        />
        <div>
          <button
            class="btn btn-error btn-sm"
            :disabled="confirmText !== 'DELETE'"
            @click="reset"
          >
            {{ t('system.reset') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'
import { confirm } from '@/components/ui/confirm'
import { toastError, toastSuccess } from '@/components/ui/toast'

const router = useRouter()
const { t } = useI18n()
const confirmText = ref('')
const restoring = ref(false)

function download() {
  window.location.href = '/api/v1/admin/system/backup'
}
async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const fd = new FormData()
  fd.append('backup_file', file)
  restoring.value = true
  try {
    await api.post('/admin/system/restore', fd)
    toastSuccess(t('system.restored'))
  } catch (e: any) {
    toastError(e.message)
  } finally {
    restoring.value = false
  }
}
async function reset() {
  const ok = await confirm({
    title: t('system.danger'),
    message: t('system.dangerNote'),
    danger: true,
    okText: t('system.reset'),
  })
  if (!ok) return
  await api.post('/admin/system/reset', { confirm: 'DELETE' })
  router.push('/login')
}
</script>
