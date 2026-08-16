import { defineStore } from 'pinia'
import { api } from '@/shared/api/client'

export const useSessionStore = defineStore('session', {
  state: () => ({ checked: false, authed: false, id: 0, username: '', role: 'viewer' }),
  getters: {
    isAdmin: (s) => s.role === 'admin',
    canWrite: (s) => s.role === 'admin' || s.role === 'operator',
  },
  actions: {
    async check() {
      try {
        const data = await api.get('/admin/session')
        this.authed = true
        this.id = Number(data.id) || 0
        this.username = data.username || ''
        this.role = data.role || 'viewer'
      } catch {
        this.authed = false
        this.id = 0
        this.role = 'viewer'
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
      this.id = 0
      this.role = 'viewer'
    },
  },
})
