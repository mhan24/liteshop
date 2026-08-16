// 通用校验（纯函数）。
export function isValidEmail(v: string): boolean {
  v = (v || '').trim()
  if (!v || v.length > 200 || /[\s]/.test(v)) return false
  const at = v.lastIndexOf('@')
  if (at <= 0 || at === v.length - 1) return false
  return v.slice(at + 1).includes('.')
}
