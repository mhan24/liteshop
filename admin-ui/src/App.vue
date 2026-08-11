<template>
  <router-view />
  <ToastHost />
  <ConfirmHost />
</template>

<script setup lang="ts">
import { watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { loadSiteFormat } from '@/utils/format'
import ToastHost from '@/components/ui/ToastHost.vue'
import ConfirmHost from '@/components/ui/ConfirmHost.vue'

const { locale } = useI18n()
watch(locale, (val) => localStorage.setItem('liteshop_admin_locale', val))
onMounted(() => {
  loadSiteFormat()
})
</script>
