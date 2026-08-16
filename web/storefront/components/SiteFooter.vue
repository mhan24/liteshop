<template>
  <footer class="mt-10 border-t bg-background p-10 text-muted-foreground">
    <div class="mx-auto grid w-full max-w-6xl grid-cols-2 gap-6 md:grid-cols-4">
      <nav v-if="contactLinks.length">
        <h6 class="mb-3 text-sm font-semibold text-foreground">{{ t('contact') }}</h6>
        <p v-for="l in contactLinks" :key="l.name + l.url" class="mb-1.5 text-sm">
          <a v-if="l.url" :href="href(l.url)" target="_blank" rel="noopener" class="text-primary hover:underline">
            {{ l.name }}
          </a>
          <span v-else>{{ l.name }}</span>
        </p>
      </nav>
      <nav v-if="friendLinks.length">
        <h6 class="mb-3 text-sm font-semibold text-foreground">{{ t('friendLinks') }}</h6>
        <ul class="space-y-1.5 text-sm">
          <li v-for="l in friendLinks" :key="l.name + l.url">
            <a v-if="l.url" :href="href(l.url)" target="_blank" rel="noopener" class="text-primary hover:underline">
              {{ l.name }}
            </a>
            <span v-else>{{ l.name }}</span>
          </li>
        </ul>
      </nav>
      <nav>
        <h6 class="mb-3 text-sm font-semibold text-foreground">{{ t('legal') }}</h6>
        <div class="space-y-1.5 text-sm">
          <NuxtLink to="/page/privacy" class="block text-primary hover:underline">{{ t('privacy') }}</NuxtLink>
          <NuxtLink to="/page/terms" class="block text-primary hover:underline">{{ t('terms') }}</NuxtLink>
        </div>
      </nav>
      <nav>
        <h6 class="mb-3 text-sm font-semibold text-foreground">{{ t('project') }}</h6>
        <a
          href="https://github.com/mhan24/liteshop"
          target="_blank"
          rel="noopener"
          class="text-primary hover:underline"
        >
          GitHub
        </a>
      </nav>
    </div>
    <div class="mx-auto mt-8 flex max-w-6xl flex-col gap-1 text-xs text-muted-foreground/70">
      <div>{{ site?.copyright }}</div>
      <div>Powered by LiteShop</div>
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
