<template>
  <footer class="bg-white border-t mt-10">
    <div class="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 md:grid-cols-4 gap-6 text-sm text-gray-600">
      <div>
        <h4 class="text-gray-900 font-semibold mb-2">联系方式</h4>
        <p v-if="!site?.contact">请通过下单邮箱联系我们。</p>
        <div v-else v-html="contactHtml"></div>
      </div>
      <div>
        <h4 class="text-gray-900 font-semibold mb-2">友情链接</h4>
        <ul>
          <li v-for="l in site?.friend_links || []" :key="l.name + l.url">
            <a v-if="l.url" :href="l.url" target="_blank" rel="noopener" class="hover:text-brand">{{ l.name }}</a>
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
const contactHtml = computed(() => {
  const text = props.site?.contact || ''
  return text
    .split('\n')
    .map((line: string) => {
      const v = line.trim()
      if (!v) return ''
      let href = ''
      if (/^https?:\/\//i.test(v)) href = v
      else if (/^www\./i.test(v)) href = 'https://' + v
      else if (/^@/.test(v)) href = 'https://t.me/' + v.slice(1)
      else if (v.includes('@')) href = 'mailto:' + v
      return href ? `<p><a class="hover:text-brand" href="${href}" target="_blank" rel="noopener">${v}</a></p>` : `<p>${v}</p>`
    })
    .join('')
})
</script>
