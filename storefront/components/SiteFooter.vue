<template>
  <footer class="bg-white border-t mt-10">
    <div class="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 md:grid-cols-4 gap-6 text-sm text-gray-600">
      <div>
        <h4 class="text-gray-900 font-semibold mb-2">{{ t('contact') }}</h4>
        <template v-if="contactLinks.length">
          <p v-for="l in contactLinks" :key="l.name + l.url">
            <a v-if="l.url" :href="href(l.url)" target="_blank" rel="noopener" class="hover:text-brand">{{ l.name }}</a>
            <span v-else>{{ l.name }}</span>
          </p>
        </template>
      </div>
      <div>
        <h4 class="text-gray-900 font-semibold mb-2">{{ t('friendLinks') }}</h4>
        <ul>
          <li v-for="l in friendLinks" :key="l.name + l.url">
            <a v-if="l.url" :href="href(l.url)" target="_blank" rel="noopener" class="hover:text-brand">{{ l.name }}</a>
            <span v-else>{{ l.name }}</span>
          </li>
        </ul>
      </div>
      <div>
        <h4 class="text-gray-900 font-semibold mb-2">{{ t('legal') }}</h4>
        <p><NuxtLink to="/page/privacy" class="hover:text-brand">{{ t('privacy') }}</NuxtLink></p>
        <p><NuxtLink to="/page/terms" class="hover:text-brand">{{ t('terms') }}</NuxtLink></p>
      </div>
      <div>
        <h4 class="text-gray-900 font-semibold mb-2">{{ t('project') }}</h4>
        <a href="https://github.com/mhan24/liteshop" target="_blank" rel="noopener" class="hover:text-brand">GitHub</a>
      </div>
    </div>
    <div class="max-w-6xl mx-auto px-4 pb-6 text-xs text-gray-500">
      <div>{{ site?.copyright }}</div>
      <div class="mt-1">Powered by LiteShop</div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ site?: any }>()
const { t } = useI18n()

const allLinks = computed(() => (props.site?.links as any[]) || [])
const contactLinks = computed(() => allLinks.value.filter((l) => l.category === 'contact'))
const friendLinks = computed(() => allLinks.value.filter((l) => l.category !== 'contact'))

function href(url: string) {
  if (!url) return '#'
  if (/^https?:\/\//i.test(url)) return url
  if (/^www\./i.test(url)) return 'https://' + url
  if (/^@/.test(url)) return 'https://t.me/' + url.slice(1)
  if (/^mailto:/i.test(url)) return url
  if (url.includes('@')) return 'mailto:' + url
  // 仅允许站内相对链接；拒绝 javascript: 等危险协议
  return url.startsWith('/') || url.startsWith('#') ? url : '#'
}
</script>
