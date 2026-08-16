<template>
  <router-view />
  <ToastHost />
  <ConfirmHost />
</template>

<script setup lang="ts">
import { watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { loadSiteFormat } from '@/shared/formatting/format'
import ToastHost from '@/shared/components/ToastHost.vue'
import ConfirmHost from '@/shared/components/ConfirmHost.vue'

const { locale } = useI18n()
watch(locale, (val) => localStorage.setItem('liteshop_admin_locale', val))
onMounted(() => {
  loadSiteFormat()
})
</script>
