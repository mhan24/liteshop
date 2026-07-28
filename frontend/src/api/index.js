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
      import('@/router').then(({ default: router }) => {
        router.push('/admin/login')
      })
    }
    const message = error?.response?.data?.error || error.message || 'Request failed'
    return Promise.reject(new Error(message))
  },
)

export const api = {
  get: (url, params) => http.get(url, { params }).then((r) => r.data),
  post: (url, data) => http.post(url, data).then((r) => r.data),
  raw: http,
}

export default http
