import { describe, expect, it } from "vitest";
import { parseClientIp } from "./client-ip";

/**
 * 客户端 IP 解析：必须取**受信代理写入**的段，而不是客户端可控的第一段。
 * 取错会导致 IP 限流可被伪造 XFF 绕过。
 */

describe("parseClientIp", () => {
  it("单层代理：取最后一段（Caddy 追加的真实来源）", () => {
    // 客户端伪造 1.2.3.4，Caddy 在末尾追加真实 IP
    expect(parseClientIp("1.2.3.4, 203.0.113.7")).toBe("203.0.113.7");
  });

  it("客户端伪造多个 IP 也不能影响结果（关键回归）", () => {
    expect(parseClientIp("9.9.9.9, 8.8.8.8, 7.7.7.7, 203.0.113.7")).toBe("203.0.113.7");
    // 取第一段的旧实现会返回 9.9.9.9 → 攻击者每请求换一个假 IP 即可绕过限流
    expect(parseClientIp("9.9.9.9, 8.8.8.8, 7.7.7.7, 203.0.113.7")).not.toBe("9.9.9.9");
  });

  it("无 XFF 时回落 x-real-ip", () => {
    expect(parseClientIp(null, "203.0.113.9")).toBe("203.0.113.9");
    expect(parseClientIp("", "203.0.113.9")).toBe("203.0.113.9");
  });

  it("都没有时返回占位符", () => {
    expect(parseClientIp(null, null)).toBe("-");
    expect(parseClientIp("", "")).toBe("-");
  });

  it("规范化 IPv6 映射与端口", () => {
    expect(parseClientIp("::ffff:203.0.113.5")).toBe("203.0.113.5");
    expect(parseClientIp("1.2.3.4, [2001:db8::1]:443")).toBe("2001:db8::1");
  });

  it("容忍空白与多余逗号", () => {
    expect(parseClientIp(" 1.2.3.4 ,  203.0.113.7  ")).toBe("203.0.113.7");
    expect(parseClientIp("1.2.3.4,")).toBe("1.2.3.4");
  });
});
