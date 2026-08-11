<template>
  <div class="form-control w-full">
    <label v-if="label" class="label pb-1 pt-0">
      <span class="label-text font-medium">
        {{ label }}<span v-if="required" class="text-error"> *</span>
      </span>
    </label>
    <slot />
    <span v-if="hint" class="label-text-alt mt-1 opacity-60">{{ hint }}</span>
  </div>
</template>

<script setup lang="ts">
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
