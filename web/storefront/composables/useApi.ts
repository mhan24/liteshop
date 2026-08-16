import { http } from '@/services/http/client'

// 兼容层：旧调用形态委托到 HTTP 基础客户端。
// 新代码请使用 features/*/api.ts + composables，页面不要直接 $fetch。
export function useApiBase() {
  return '/api/v1'
}

export function apiUrl(path: string) {
  return useApiBase() + path
}

export function useApi() {
  return {
    get: <T = any>(path: string, query?: any, headers?: any) => http.get<T>(path, query, headers),
    post: <T = any>(path: string, body?: any, headers?: any) => http.post<T>(path, body, headers),
  }
}
