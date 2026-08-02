<template>
  <el-container class="admin-layout">
    <el-aside :width="collapsed ? '64px' : '220px'" class="side">
      <div class="logo">
        <router-link to="/">LiteShop 后台</router-link>
      </div>
      <el-menu :collapse="collapsed" :default-active="activeMenu" background-color="#1f2329" text-color="#cfd3dc" active-text-color="#ffffff">
        <el-menu-item index="/" @click="router.push('/')">
          <el-icon><HomeFilled /></el-icon><template #title>后台首页</template>
        </el-menu-item>
        <el-menu-item index="/products" @click="router.push('/products')">
          <el-icon><Goods /></el-icon><template #title>商品管理</template>
        </el-menu-item>
        <el-menu-item index="/orders" @click="router.push('/orders')">
          <el-icon><List /></el-icon><template #title>订单管理</template>
        </el-menu-item>
        <el-menu-item index="/settings" @click="router.push('/settings')">
          <el-icon><Wallet /></el-icon><template #title>支付设置</template>
        </el-menu-item>
        <el-menu-item index="/notify" @click="router.push('/notify')">
          <el-icon><Bell /></el-icon><template #title>通知设置</template>
        </el-menu-item>
        <el-menu-item index="/site" @click="router.push('/site')">
          <el-icon><Setting /></el-icon><template #title>站点设置</template>
        </el-menu-item>
        <el-menu-item index="/account" @click="router.push('/account')">
          <el-icon><User /></el-icon><template #title>账号</template>
        </el-menu-item>
        <el-menu-item index="/system" @click="router.push('/system')">
          <el-icon><Tools /></el-icon><template #title>系统</template>
        </el-menu-item>
        <el-menu-item index="site-link">
          <el-icon><Link /></el-icon><template #title><a href="/" target="_blank" class="site-link">前台</a></template>
        </el-menu-item>
        <el-menu-item index="logout" @click="logout">
          <el-icon><SwitchButton /></el-icon><template #title>退出登录</template>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="topbar">
        <el-button text @click="collapsed = !collapsed">
          <el-icon><Expand v-if="collapsed" /><Fold v-else /></el-icon>
        </el-button>
      </el-header>
      <el-main class="content">
        <router-view v-slot="{ Component }">
          <transition name="el-fade-in-linear" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { HomeFilled, Goods, List, Wallet, Bell, Setting, User, Tools, Link, SwitchButton, Expand, Fold } from '@element-plus/icons-vue'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const router = useRouter()
const store = useSessionStore()
const collapsed = ref(false)
const activeMenu = computed(() => {
  if (route.path.startsWith('/products')) return '/products'
  if (route.path.startsWith('/orders')) return '/orders'
  return route.path
})

onMounted(() => {
  collapsed.value = window.innerWidth < 768
})

async function logout() {
  await ElMessageBox.confirm('确定退出登录吗？', '提示', { type: 'warning' })
  await store.logout()
  router.push('/login')
}
</script>

<style scoped>
.admin-layout {
  min-height: 100vh;
}
.side {
  background: #1f2329;
  transition: width 0.2s;
  overflow: hidden;
}
.logo {
  color: #fff;
  font-weight: 800;
  padding: 18px 16px;
  white-space: nowrap;
}
.logo a {
  color: #fff;
  text-decoration: none;
}
.side :deep(.el-menu) {
  border-right: none;
}
.site-link {
  color: inherit;
  text-decoration: none;
  display: block;
  width: 100%;
}
.site-link:hover {
  color: #fff;
}
.topbar {
  display: flex;
  align-items: center;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
}
.content {
  background: #f5f7fa;
  padding: 16px;
}
@media (max-width: 768px) {
  .content {
    padding: 10px;
  }
}
</style>
