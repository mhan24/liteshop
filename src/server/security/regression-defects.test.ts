import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 针对 monkeyscan 报告的回归锁定。
 *
 * 这批问题多数已在早前几轮修复，但**没有任何测试守护**，随时可能被改回。
 * 本文件以「断言源码实际行为」的方式固定住它们。
 */

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("已修复项的回归锁定", () => {
  it("12c93 健康检查不泄露数据库错误原文", () => {
    const src = read("src/app/api/health/route.ts");
    // 500 分支不得把 err.message 放进响应体
    expect(src).not.toMatch(/error:\s*err\s+instanceof\s+Error\s*\?\s*err\.message/);
    expect(src).toContain("console.error");
    // 响应体只含 ok:false
    expect(src).toMatch(/Response\.json\(\s*\{\s*ok:\s*false\s*\}\s*,\s*\{\s*status:\s*500\s*\}\s*\)/);
  });

  it("51e35 mock 支付不再内置默认令牌（fail closed）", () => {
    const src = read("src/server/payment/mock.ts");
    expect(src).not.toContain("mock-token");
    // 必须 fail closed：未配置令牌即抛错，而非回退到内置常量
    expect(src).toMatch(/if\s*\(!value\)\s*throw\s*new\s+Error/);
    expect(src).not.toMatch(/DEFAULT_TOKEN/);
  });

  it("16f4b 登录不再回退到硬编码默认口令", () => {
    const src = read("src/server/auth.ts");
    expect(src).not.toContain("admin123");
    expect(src).not.toMatch(/password\s*===\s*envConfig\.adminPasswordDev/);
  });

  it("118b9 Secure 不再可被请求头降级", () => {
    const src = read("src/lib/cookie-policy.ts");
    // 生产恒为 true：请求头只影响非生产
    expect(src).toMatch(/return\s+isProduction\s*\|\|/);
    expect(read("src/actions/admin.ts")).toContain("secureCookie(");
  });

  it("78e62 审计日志字段经过净化", () => {
    const src = read("src/server/admin-log.ts");
    expect(src).toMatch(/safeLogText\(target/);
    expect(src).toMatch(/safeLogText\(action/);
  });

  it("1d5e3 getSiteUrl 经 URL 校验，邮件 href 经转义", () => {
    expect(read("src/server/settings.ts")).toMatch(/export function getSiteUrl[\s\S]*normalizeHttpUrl/);
    const mail = read("src/server/mail.ts");
    // 所有拼进 HTML 的 URL 都必须转义
    expect(mail).toMatch(/href="\$\{escapeHtml\(lookupUrl\)\}"/);
  });

  it("763d8 收银台跳转前校验协议", () => {
    const src = read("src/lib/open-payment-window.ts");
    expect(src).toMatch(/normalizeHttpUrl\(rawUrl/);
    expect(src).toMatch(/normalizeHttpUrl\(url,\s*window\.location\.origin\)/);
  });

  it("887d7/fd67f apiBase 校验拒绝内网与云元数据地址（保存侧与使用侧共用）", () => {
    const bepusdt = read("src/server/payment/bepusdt.ts");
    expect(bepusdt).toMatch(/169\\?\.254|169\\\.254/);
    expect(bepusdt).toContain("metadata.google.internal");
    expect(bepusdt).toContain("100.100.100.200");
    // 使用侧必须走同一个归一化函数
    expect(bepusdt).toMatch(/apiBase:\s*normalizeBepusdtApiBase/);
    // 保存侧同样使用它（而非仅前缀正则）
    const admin = read("src/actions/admin.ts");
    expect(admin).toMatch(/normalizeBepusdtApiBase\(apiBase\)/);
  });

  it("0c903/6e504 订单状态接口需凭据且有限流", () => {
    const route = read("src/app/api/orders/status/route.ts");
    expect(route).toContain("hasOrderAccess");
    expect(route).toContain("checkOrderStatusRateLimit");
    // 未授权与不存在返回同样的状态，避免存在性预言机
    expect(route).toMatch(/hasOrderAccess[\s\S]*?status:\s*404/);
  });

  it("27e0c 应用层兜底设置安全响应头", () => {
    const cfg = read("next.config.ts");
    expect(cfg).toContain("async headers()");
    for (const h of [
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Strict-Transport-Security",
      "Content-Security-Policy",
      "Referrer-Policy",
    ]) {
      expect(cfg, h).toContain(h);
    }
    expect(cfg).toContain("frame-ancestors 'none'");
  });

  it("230be/2f13f 限流与登录锁定计数已持久化到 DB", () => {
    expect(read("src/db/schema.ts")).toContain("rateLimitCounters");
    const rl = read("src/server/security/rate-limit.ts");
    expect(rl).toContain("loadFromDb");
    expect(rl).toContain("persistToDb");
    const auth = read("src/server/auth.ts");
    expect(auth).toContain("loadAttempt");
    expect(auth).toContain("persistAttempt");
  });
});