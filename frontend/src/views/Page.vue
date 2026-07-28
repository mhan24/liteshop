<template>
  <a-card :title="title">
    <p style="white-space:pre-wrap">{{ content }}</p>
  </a-card>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '@/api'

const route = useRoute()
const title = ref('')
const content = ref('')

const titles = { privacy: '隐私政策', terms: '服务条款' }

async function load() {
  const slug = route.params.slug === 'privacy' ? 'privacy' : 'terms'
  title.value = titles[slug]
  const data = await api.get('/pages/' + slug)
  content.value = data.content
}
onMounted(load)
watch(() => route.params.slug, load)
</script>
