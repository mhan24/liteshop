<template>
  <Card>
    <CardHeader v-if="title">
      <CardTitle class="text-lg">{{ title }}</CardTitle>
    </CardHeader>
    <CardContent :class="title ? 'pt-0' : ''">
      <div v-if="loading" class="flex justify-center py-10">
        <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
      <slot v-else />
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Loader2 } from '@lucide/vue'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

withDefaults(
  defineProps<{
    title?: string
    loading?: boolean
  }>(),
  {
    title: '',
    loading: false,
  },
)
</script>
