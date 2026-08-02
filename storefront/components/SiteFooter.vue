<template>
  <footer class="bg-white border-t mt-10">
    <div class="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 md:grid-cols-4 gap-6 text-sm text-gray-600">
      <div>
        <h4 class="text-gray-900 font-semibold mb-2">联系方式</h4>
        <template v-if="contactLinks.length">
          <p v-for="l in contactLinks" :key="l.name + l.url">
            <a v-if="l.url" :href="href(l.url)" target="_blank" rel="noopener" class="hover:text-brand">{{ l.name }}</a>
            <span v-else>{{ l.name }}</span>
          </p>
        </template>
        <p v-else>请通过下单邮箱联系我们。</p>
      </div>
      <div>
        <h4 class="text-gray-900 font-semibold mb-2">友情链接</h4>
        <ul>
          <li v-for="l in friendLinks" :key="l.name + l.url">
            <a v-if="l.url" :href="href(l.url)" target="_blank" rel="noopener" class="hover:text-brand">{{ l.name }}</a>
            <span v-else>{{ l.name }}</span>
          </li>
        </ul>
      </div>
      <div>
        <h4 class="text-gray-900 font-semibold mb-2">法律信息</h4>
        <p><NuxtLink to="/page/privacy" class="hover:text-brand">隐私政策</NuxtLink></p>
        <p><NuxtLink to="/page/terms" class="hover:text-brand">服务条款</NuxtLink></p>
      </div>
      <div>
        <h4 class="text-gray-900 font-semibold mb-2">项目</h4>
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

const allLinks = computed(() => (props.site?.links as any[]) || [])
const contactLinks = computed(() => allLinks.value.filter((l) => l.category === 'contact'))
const friendLinks = computed(() => allLinks.value.filter((l) => l.category !== 'contact'))

function href(url: string) {
  if (!url) return '#'
  if (/^https?:\/\//i.test(url)) return url
  if (/^www\./i.test(url)) return 'https://' + url
  if (/^@/.test(url)) return 'https://t.me/' + url.slice(1)
  if (url.includes('@')) return 'mailto:' + url
  return url
}
</script>
