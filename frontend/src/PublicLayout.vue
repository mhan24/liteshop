<template>
  <a-layout style="min-height:100vh">
    <a-layout-header class="app-header">
      <div class="brand">
        <router-link to="/">{{ site.title || 'LiteShop' }}</router-link>
      </div>
      <a-menu mode="horizontal" :selectable="false" class="top-menu">
        <a-menu-item key="home"><router-link to="/">商品</router-link></a-menu-item>
        <a-menu-item key="order"><router-link to="/order">订单查询</router-link></a-menu-item>
      </a-menu>
    </a-layout-header>
    <a-layout-content class="page-wrap">
      <div class="container">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </div>
    </a-layout-content>
    <a-layout-footer class="app-footer">
      <a-row :gutter="[24, 16]">
        <a-col :xs="24" :md="10">
          <h4>联系方式</h4>
          <div v-if="site.contact" class="muted" v-html="contactHtml"></div>
          <p v-else class="muted">请通过下单邮箱联系我们。</p>
        </a-col>
        <a-col :xs="24" :md="7">
          <h4>友情链接</h4>
          <ul class="link-list">
            <li v-for="l in site.friend_links || []" :key="l.name + l.url">
              <a v-if="l.url" :href="l.url" target="_blank" rel="noopener">{{ l.name }}</a>
              <span v-else>{{ l.name }}</span>
            </li>
          </ul>
        </a-col>
        <a-col :xs="24" :md="7">
          <h4>法律信息</h4>
          <p><router-link to="/page/privacy">隐私政策</router-link></p>
          <p><router-link to="/page/terms">服务条款</router-link></p>
        </a-col>
      </a-row>
      <div class="copyright muted">{{ site.copyright }}</div>
      <div class="powered muted">
        Powered by
        <a href="https://github.com/mhan24/liteshop" target="_blank" rel="noopener">LiteShop</a>
      </div>
    </a-layout-footer>
  </a-layout>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { api } from '@/api'

const site = ref({})

async function loadSite() {
  try {
    site.value = await api.get('/site')
  } catch (e) {
    site.value = {}
  }
}

onMounted(loadSite)

const contactHtml = computed(() => {
  const text = site.value.contact || ''
  return text
    .split('\n')
    .map((line) => {
      const v = line.trim()
      if (!v) return ''
      let href = ''
      if (/^https?:\/\//i.test(v)) href = v
      else if (/^www\./i.test(v)) href = 'https://' + v
      else if (/^@/.test(v)) href = 'https://t.me/' + v.slice(1)
      else if (v.includes('@')) href = 'mailto:' + v
      return href ? `<p><a href="${href}" target="_blank" rel="noopener">${v}</a></p>` : `<p>${v}</p>`
    })
    .join('')
})
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  height: 64px;
  position: sticky;
  top: 0;
  z-index: 20;
}
.brand a {
  color: #111;
  font-weight: 800;
  font-size: 18px;
}
.top-menu {
  border-bottom: none;
  flex: 1;
}
.app-footer {
  background: #fff;
  border-top: 1px solid #f0f0f0;
}
.app-footer h4 {
  margin-bottom: 10px;
}
.link-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.copyright {
  margin-top: 20px;
}
.powered {
  margin-top: 4px;
  font-size: 12px;
}
</style>
