import { describe, expect, it, vi, afterEach } from "vitest";
import { verifyTurnstileToken } from "./turnstile";

describe("verifyTurnstileToken（siteverify）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("空 token 直接拒绝", async () => {
    expect((await verifyTurnstileToken("", "sec")).ok).toBe(false);
    expect((await verifyTurnstileToken("  ", "sec")).ok).toBe(false);
  });

  it("siteverify success=true 通过（携带 remoteip）", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body);
      expect(body).toContain("secret=sec");
      expect(body).toContain("response=tok123");
      expect(body).toContain("remoteip=1.2.3.4");
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect((await verifyTurnstileToken("tok123", "sec", "1.2.3.4")).ok).toBe(true);
  });

  it("success=false 携带错误码", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 }))
    );
    const r = await verifyTurnstileToken("bad", "sec");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("invalid-input-response");
  });

  it("网络异常拒绝不抛出", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    const r = await verifyTurnstileToken("tok", "sec");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("boom");
  });
});
