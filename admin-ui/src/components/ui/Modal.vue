<template>
  <transition name="modal-fade">
    <div v-if="open" class="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div class="fixed inset-0 bg-black/50" @click="close"></div>
      <div class="modal-box relative z-10 w-full max-w-lg shadow-2xl" role="dialog" aria-modal="true">
        <h3 v-if="title" class="mb-4 text-lg font-bold">{{ title }}</h3>
        <slot />
        <div v-if="showFooter" class="modal-action">
          <slot name="footer">
            <button class="btn btn-ghost" :disabled="loading" @click="close">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary" :class="{ 'btn-disabled': loading }" @click="$emit('confirm')">
              <span v-if="loading" class="loading loading-spinner loading-xs"></span>
              {{ t('common.confirm') }}
            </button>
          </slot>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    loading?: boolean
    showFooter?: boolean
  }>(),
  {
    title: '',
    loading: false,
    showFooter: true,
  },
)

const emit = defineEmits<{
  'update:open': [v: boolean]
  close: []
  confirm: []
}>()

const { t } = useI18n()

function close() {
  emit('update:open', false)
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) close()
}

watch(
  () => props.open,
  (open) => {
    if (open) document.addEventListener('keydown', onKeydown)
    else document.removeEventListener('keydown', onKeydown)
  },
)

onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
