import { defineStore } from 'pinia'
import { api } from '@/api'

export const useSessionStore = defineStore('session', {
  state: () => ({ checked: false, authed: false }),
  actions: {
    async check() {
      try {
        await api.get('/admin/session')
        this.authed = true
      } catch {
        this.authed = false
      } finally {
        this.checked = true
      }
    },
    async logout() {
      try {
        await api.post('/admin/logout', {})
      } catch {
        // ignore
      }
      this.authed = false
    },
  },
})
