export function useApiBase() {
  const url = useRequestURL()
  return url.origin + '/api/v1'
}

export function apiUrl(path: string) {
  return useApiBase() + path
}

export function useApi() {
  const base = useApiBase()
  return {
    get: <T = any>(path: string, query?: any, headers?: any) =>
      $fetch<T>(base + path, { query, headers }),
    post: <T = any>(path: string, body?: any, headers?: any) =>
      $fetch<T>(base + path, { method: 'POST', body, headers, credentials: 'include' as any }),
  }
}
