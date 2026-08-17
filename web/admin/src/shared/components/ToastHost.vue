<template>
  <Toaster
    position="top-right"
    theme="light"
    :rich-colors="true"
    :close-button="true"
    :duration="3600"
    class="admin-toaster"
    :style="{
      top: '4.5rem',
      right: '1rem',
      bottom: 'auto',
      zIndex: 2147483000,
    }"
    :toast-options="{
      classes: {
        toast: 'admin-toast',
      },
    }"
  />
</template>

<script setup lang="ts">
import { Toaster } from '@/shared/components/ui/sonner'
</script>
