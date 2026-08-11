<template>
  <img :src="imgSrc" :alt="alt || ''" class="h-full w-full rounded-lg object-cover" loading="lazy" @error="onError" />
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    src?: string
    fallback?: string
    alt?: string
  }>(),
  {
    src: '',
    fallback: '/default-product.svg',
    alt: '',
  },
)

const imgSrc = ref(props.src || props.fallback)

watch(
  () => props.src,
  (v) => {
    imgSrc.value = v || props.fallback
  },
)

function onError() {
  if (imgSrc.value !== props.fallback) imgSrc.value = props.fallback
}
</script>
