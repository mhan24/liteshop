<template>
  <div class="w-full space-y-1.5">
    <Label v-if="label" class="text-sm font-medium">
      {{ label }}<span v-if="required" class="text-destructive"> *</span>
    </Label>
    <slot />
    <p v-if="hint" class="text-xs text-muted-foreground">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
import { Label } from '@/components/ui/label'

withDefaults(
  defineProps<{
    label?: string
    hint?: string
    required?: boolean
  }>(),
  {
    label: '',
    hint: '',
    required: false,
  },
)
</script>
