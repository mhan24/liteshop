import { reactive } from 'vue'

// 统一操作结果反馈：成功/失败/警告用模态框展示，不自动跳转。
// 用法：
//   const result = useResult()
//   <ResultModal v-bind="result.modal" />
//   try { await api.post(...); result.success('已保存') } catch(e) { result.error(e.message) }
export function useResult() {
  const state = reactive({
    open: false,
    type: 'success' as 'success' | 'error' | 'warning',
    title: '',
    message: '',
  })

  function show(type: 'success' | 'error' | 'warning', message: string, title = '') {
    state.type = type
    state.message = message
    state.title = title
    state.open = true
  }

  return {
    modal: state,
    success: (msg: string, title = '') => show('success', msg, title),
    error: (msg: string, title = '') => show('error', msg, title),
    warning: (msg: string, title = '') => show('warning', msg, title),
    close: () => (state.open = false),
  }
}