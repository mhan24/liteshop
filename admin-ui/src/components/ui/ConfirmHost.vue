<template>
  <Modal
    :open="confirmState.visible"
    :title="confirmState.title"
    @close="settleConfirm(false)"
  >
    <p class="text-sm leading-relaxed opacity-80">{{ confirmState.message }}</p>
    <template #footer>
      <button class="btn btn-ghost" @click="settleConfirm(false)">
        {{ confirmState.cancelText || t('common.cancel') }}
      </button>
      <button class="btn" :class="confirmState.danger ? 'btn-error' : 'btn-primary'" @click="settleConfirm(true)">
        {{ confirmState.okText || t('common.confirm') }}
      </button>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Modal from './Modal.vue'
import { confirmState, settleConfirm } from './confirm'

const { t } = useI18n()
</script>
