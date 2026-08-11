<template>
  <footer class="footer bg-base-100 border-t border-base-300 text-base-content/70 p-10 mt-10">
    <nav v-if="contactLinks.length">
      <h6 class="footer-title text-base-content">{{ t('contact') }}</h6>
      <p v-for="l in contactLinks" :key="l.name + l.url">
        <a v-if="l.url" :href="href(l.url)" target="_blank" rel="noopener" class="link link-hover link-primary">{{ l.name }}</a>
        <span v-else>{{ l.name }}</span>
      </p>
    </nav>
    <nav v-if="friendLinks.length">
      <h6 class="footer-title text-base-content">{{ t('friendLinks') }}</h6>
      <ul>
        <li v-for="l in friendLinks" :key="l.name + l.url">
          <a v-if="l.url" :href="href(l.url)" target="_blank" rel="noopener" class="link link-hover link-primary">{{ l.name }}</a>
          <span v-else>{{ l.name }}</span>
        </li>
      </ul>
    </nav>
    <nav>
      <h6 class="footer-title text-base-content">{{ t('legal') }}</h6>
      <NuxtLink to="/page/privacy" class="link link-hover link-primary">{{ t('privacy') }}</NuxtLink>
      <NuxtLink to="/page/terms" class="link link-hover link-primary">{{ t('terms') }}</NuxtLink>
    </nav>
    <nav>
      <h6 class="footer-title text-base-content">{{ t('project') }}</h6>
      <a href="https://github.com/mhan24/liteshop" target="_blank" rel="noopener" class="link link-hover link-primary">GitHub</a>
    </nav>
    <aside class="footer-aside w-full flex flex-col gap-1 text-xs text-base-content/50">
      <div>{{ site?.copyright }}</div>
      <div>Powered by LiteShop</div>
    </aside>
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
