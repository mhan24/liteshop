<template>
  <el-config-provider :locale="elementLocale">
    <router-view />
  </el-config-provider>
</template>

<script setup lang="ts">
import { computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import enUs from 'element-plus/dist/locale/en.mjs'
import { loadSiteFormat } from '@/utils/format'

const { locale } = useI18n()
const elementLocale = computed(() => (locale.value === 'en' ? enUs : zhCn))
watch(locale, (val) => localStorage.setItem('liteshop_admin_locale', val))
onMounted(() => {
  loadSiteFormat()
})
</script>
