<template>
  <a-layout style="min-height:100vh">
    <a-layout-sider v-model:collapsed="collapsed" :trigger="null" collapsible breakpoint="lg">
      <div class="logo"><router-link to="/admin">LiteShop 后台</router-link></div>
      <a-menu theme="dark" mode="inline" :selected-keys="[activeKey]">
        <a-menu-item key="/admin"><router-link to="/admin">后台首页</router-link></a-menu-item>
        <a-menu-item key="/admin/products"><router-link to="/admin/products">商品管理</router-link></a-menu-item>
        <a-menu-item key="/admin/orders"><router-link to="/admin/orders">订单管理</router-link></a-menu-item>
        <a-menu-item key="/admin/settings"><router-link to="/admin/settings">支付设置</router-link></a-menu-item>
        <a-menu-item key="/admin/notify"><router-link to="/admin/notify">通知设置</router-link></a-menu-item>
        <a-menu-item key="/admin/site"><router-link to="/admin/site">站点设置</router-link></a-menu-item>
        <a-menu-item key="/admin/account"><router-link to="/admin/account">账号</router-link></a-menu-item>
        <a-menu-item key="/admin/system"><router-link to="/admin/system">系统</router-link></a-menu-item>
        <a-menu-item key="/"><a href="/" target="_blank">前台</a></a-menu-item>
        <a-menu-item key="logout" @click="logout">退出登录</a-menu-item>
      </a-menu>
    </a-layout-sider>
    <a-layout>
      <a-layout-header class="admin-header">
        <a-button type="text" @click="collapsed = !collapsed">
          <menu-unfold-outlined v-if="collapsed" />
          <menu-fold-outlined v-else />
        </a-button>
      </a-layout-header>
      <a-layout-content class="admin-content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Modal } from 'ant-design-vue'
import { MenuUnfoldOutlined, MenuFoldOutlined } from '@ant-design/icons-vue'
import { api } from '@/api'

const collapsed = ref(false)
const route = useRoute()
const router = useRouter()
const activeKey = computed(() => route.path)

async function logout() {
  Modal.confirm({
    title: '确定退出登录吗？',
    okText: '退出',
    cancelText: '取消',
    async onOk() {
      try {
        await api.post('/admin/logout', {})
      } catch (e) {
        // ignore network error, still leave
      }
      router.push('/admin/login')
    },
  })
}

router.beforeEach(async (to) => {
  if (to.path.startsWith('/admin') && to.path !== '/admin/login') {
    try {
      const { api } = await import('@/api')
      await api.get('/admin/session')
    } catch (e) {
      return '/admin/login'
    }
  }
})
</script>

<style scoped>
.logo {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 800;
}
.logo a {
  color: #fff;
}
.admin-header {
  background: #fff;
  padding: 0 16px;
}
.admin-content {
  margin: 12px;
  padding: 16px;
  background: #fff;
  border-radius: 12px;
  min-height: 360px;
}
@media (max-width: 768px) {
  .admin-content {
    margin: 8px;
    padding: 12px;
    border-radius: 0;
  }
  .logo {
    font-size: 14px;
  }
}
</style>
