import { describe, expect, it } from "vitest";
import { csrfToken, assertCsrf } from "./session";

/** CSRF：绑定会话版本 + Origin 同源校验 */

describe("CSRF token 绑定会话版本", () => {
  it("同版本稳定、跨版本不同（改密后旧 token 应失效）", async () => {
    const a1 = await csrfToken(1);
    const a2 = await csrfToken(1);
    const b = await csrfToken(2);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("token 不随会话版本为 undefined 而崩溃（默认 1）", async () => {
    const t = await csrfToken();
    expect(t).toBe(await csrfToken(1));
  });

  it("正确 token 通过校验", async () => {
    const t = await csrfToken(3);
    await expect(assertCsrf(t, 3)).resolves.toBeUndefined();
  });

  it("错误 token 被拒", async () => {
    await expect(assertCsrf("wrong", 3)).rejects.toThrow(/CSRF/);
    await expect(assertCsrf(null, 3)).rejects.toThrow(/CSRF/);
  });

  it("旧会话版本的 token 在新版本下失效（轮换生效）", async () => {
    const old = await csrfToken(1);
    await expect(assertCsrf(old, 2)).rejects.toThrow(/CSRF/);
  });
});

describe("CSRF Origin 同源校验", () => {
  const mk = (origin?: string, host = "shop.example.com") => {
    const h = new Headers();
    if (origin) h.set("origin", origin);
    h.set("host", host);
    return h;
  };

  it("同源通过", async () => {
    await expect(assertCsrf(await csrfToken(1), 1, mk("https://shop.example.com"))).resolves.toBeUndefined();
  });

  it("跨站 Origin 被拒（即使 token 正确也不行）", async () => {
    const good = await csrfToken(1);
    await expect(assertCsrf(good, 1, mk("https://evil.com"))).rejects.toThrow(/跨站/);
  });

  it("非法 Origin 被拒", async () => {
    await expect(assertCsrf(await csrfToken(1), 1, mk("not-a-url"))).rejects.toThrow(/CSRF/);
  });

  it("无 Origin 时回落到 token 校验", async () => {
    await expect(assertCsrf(await csrfToken(1), 1, mk())).resolves.toBeUndefined();
  });
});
