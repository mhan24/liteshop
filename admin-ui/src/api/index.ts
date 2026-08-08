import axios from 'axios'

const http = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  timeout: 20000,
})

http.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const status = error?.response?.status
    const path = window.location.pathname || ''
    if (status === 401 && path.startsWith('/admin') && !path.startsWith('/admin/login')) {
      import('@/router').then(({ default: router }) => router.push('/admin/login'))
    }
    const message = error?.response?.data?.error || error.message || '请求失败'
    return Promise.reject(new Error(message))
  },
)

export const api = {
  get: <T = any>(url: string, params?: any) => http.get<T>(url, { params }).then((r) => r.data),
  post: <T = any>(url: string, data?: any) => http.post<T>(url, data).then((r) => r.data),
}

export default http
