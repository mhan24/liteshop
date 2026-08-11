<template>
  <div class="space-y-4">
    <Card>
      <CardHeader>
        <CardTitle class="text-lg">{{ t('system.backup') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <p class="text-sm text-muted-foreground">{{ t('system.backupNote') }}</p>
        <p class="text-sm font-medium text-amber-600">{{ t('system.backupWarning') }}</p>
        <div class="flex flex-wrap items-center gap-2">
          <Button size="sm" @click="download">{{ t('system.downloadBackup') }}</Button>
          <label class="inline-flex">
            <Button as-child variant="outline" size="sm">
              <span class="inline-flex items-center gap-2">
                <Loader2 v-if="restoring" class="animate-spin" />
                {{ t('system.restore') }}
              </span>
              <input type="file" class="hidden" accept=".json,application/json" @change="onFileChange" />
            </Button>
          </label>
        </div>
      </CardContent>
    </Card>

    <Card class="border-destructive/30">
      <CardHeader>
        <CardTitle class="text-lg text-destructive">{{ t('system.danger') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <p class="text-sm text-muted-foreground">{{ t('system.dangerNote') }}</p>
        <Input
          v-model="confirmText"
          class="max-w-60"
          :placeholder="t('system.deleteConfirm')"
        />
        <Button variant="destructive" size="sm" :disabled="confirmText !== 'DELETE'" @click="reset">
          {{ t('system.reset') }}
        </Button>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { api } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { confirm } from '@/components/confirm'
import { toastError, toastSuccess } from '@/components/toast'

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
