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
    get: <T = any>(path: string, query?: any) => $fetch<T>(base + path, { query }),
    post: <T = any>(path: string, body?: any) =>
      $fetch<T>(base + path, { method: 'POST', body, credentials: 'include' as any }),
  }
}
