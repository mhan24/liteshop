import { computed } from 'vue'
import { useSessionStore } from '@/stores/session'

// 会话状态 hook：封装登录态/角色/登出。
export function useSession() {
  const store = useSessionStore()
  const authed = computed(() => store.authed)
  const username = computed(() => store.username)
  const role = computed(() => store.role)
  const isAdmin = computed(() => store.isAdmin)
  const canWrite = computed(() => store.canWrite)

  async function ensure() {
    if (!store.checked) await store.check()
  }

  return { authed, username, role, isAdmin, canWrite, ensure, logout: () => store.logout() }
}
