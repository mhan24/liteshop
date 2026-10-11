/** slug 生成：中文转拼音不可用时退化为时间戳；英文数字保留，空白转连字符 */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  // 含中文时直接用短随机段，保证 URL 可用
  if (/[\u4e00-\u9fff]/.test(base) || base === "") {
    return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }
  return base;
}
