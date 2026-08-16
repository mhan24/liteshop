import { ofetch } from 'ofetch'
import { ApiError } from './errors'
import { InterceptorChain } from './interceptors'

// HTTP 基础客户端：统一 baseURL / JSON / 错误归一化 / 拦截器。
// 页面不直接使用本客户端，业务 API 统一放 features/*/api.ts。
export class ApiClient {
  interceptors = new InterceptorChain()

  constructor(public base: string = '/api/v1') {}

  async get<T = any>(path: string, query?: Record<string, any>, headers?: Record<string, string>): Promise<T> {
    return this.request(this.base + path, { method: 'GET', query, headers })
  }

  async post<T = any>(path: string, body?: any, headers?: Record<string, string>): Promise<T> {
    return this.request(this.base + path, { method: 'POST', body, headers })
  }

  private async request(path: string, opts: Record<string, any>): Promise<any> {
    const config = useRuntimeConfig()
    const apiBase = import.meta.server ? config.apiBase : config.public.apiBase
    const url = path.startsWith(this.base) ? apiBase + path.slice(this.base.length) : path
    const init: Record<string, any> = { ...opts, credentials: 'include' as RequestCredentials }
    if (import.meta.server) {
      Object.assign(init, { headers: { ...useRequestHeaders(['cookie']), ...opts.headers } })
    }
    const ctx = this.interceptors.applyRequest({ url, init })
    try {
      const data = await ofetch(ctx.url, ctx.init)
      return this.interceptors.applyResponse(data)
    } catch (e: any) {
      if (e?.response) {
        throw new ApiError(e?.data?.error || `请求失败 (${e.response.status})`, e.response.status, e.data)
      }
      throw e
    }
  }
}

export const http = new ApiClient()
