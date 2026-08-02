import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

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
