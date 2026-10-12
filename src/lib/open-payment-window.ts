/**
 * 收银台跳转：必须在新窗口打开并夺取焦点。
 *
 * 浏览器只会对「用户手势直接触发」的 window.open 授予弹窗许可，
 * 因此本函数必须在 click 处理函数内同步调用（不可 await 后再调用）。
 * 若被弹窗拦截，则回退为当前标签页跳转，避免买家卡在待支付页。
 */

export function openPaymentWindow(rawUrl: string | null | undefined): void {
  const url = (rawUrl ?? "").trim();
  if (!url) return;

  const win = window.open(url, "_blank", "noopener,noreferrer");

  if (!win) {
    // 弹窗被拦截：回退当前页跳转，保证支付链路可达
    window.location.href = url;
    return;
  }

  // 新窗口获取焦点：被浏览器延迟授予/后台打开时补一次聚焦
  try {
    win.focus();
  } catch {
    // 跨域窗口 focus 可能抛错，忽略即可
  }
}

/** 使新窗口 URL 绝对化（mock 收银台为站内相对路径） */
export function toAbsoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}
