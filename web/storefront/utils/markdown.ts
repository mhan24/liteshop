import MarkdownIt from 'markdown-it'

const md = new MarkdownIt('default', {
  html: false,
  linkify: true,
  breaks: true,
})
// 显式链接协议白名单（markdown-it 15 默认已拦 javascript:/vbscript:/file:/data:，此处再加固）。
md.validateLink = (url: string) => /^(https?:|mailto:|\/|#)/i.test(url)

export function renderMarkdown(src?: string): string {
  if (!src) return ''
  return md.render(src)
}

export function markdownText(src?: string): string {
  if (!src) return ''
  return src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~\-|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
