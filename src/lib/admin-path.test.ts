import { describe, expect, it } from "vitest";

/**
 * 开放重定向回归：登录 next 参数只允许站内相对路径。
 * 复刻 actions/admin.ts 的 isSafeInternalPath（保持同步）。
 */
function isSafeInternalPath(p: string): boolean {
  if (!p.startsWith("/")) return false;
  if (p.startsWith("//")) return false;
  if (p.includes("\\")) return false;
  if (/[\u0000-\u001f]/.test(p)) return false;
  return true;
}

describe("登录跳转目标校验（防开放重定向）", () => {
  it("拒绝协议相对 URL（关键：//evil.com 也以 / 开头）", () => {
    expect(isSafeInternalPath("//evil.com")).toBe(false);
    expect(isSafeInternalPath("//evil.com/admin")).toBe(false);
  });

  it("拒绝反斜杠变体（浏览器会把 \\ 规范化为 /）", () => {
    expect(isSafeInternalPath("/\\evil.com")).toBe(false);
    expect(isSafeInternalPath("/admin\\..\\..")).toBe(false);
  });

  it("拒绝绝对 URL 与控制字符", () => {
    expect(isSafeInternalPath("https://evil.com")).toBe(false);
    expect(isSafeInternalPath("javascript:alert(1)")).toBe(false);
    expect(isSafeInternalPath("/admin\u0000")).toBe(false);
    expect(isSafeInternalPath("/admin\nSet-Cookie: x")).toBe(false);
  });

  it("放行正常站内路径", () => {
    expect(isSafeInternalPath("/admin")).toBe(true);
    expect(isSafeInternalPath("/my-panel/products")).toBe(true);
    expect(isSafeInternalPath("/admin/orders?status=pending")).toBe(true);
  });
});
