import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken, TURNSTILE_VERIFY_URL } from "@/lib/turnstile";

/** siteverify 服务端校验：token 一次性、错误码透传、网络异常不抛出 */

function stubFetch(payload: unknown, status = 200) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyTurnstileToken", () => {
  it("空 token 直接拒绝，不发起网络请求", async () => {
    const fetchMock = stubFetch({ success: true });
    await expect(verifyTurnstileToken("  ", "secret")).resolves.toEqual({
      ok: false,
      error: "missing-token",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("siteverify success=true 通过；secret 与 token 以表单提交", async () => {
    const fetchMock = stubFetch({ success: true });
    await expect(verifyTurnstileToken("tok-1", "sec-1", "203.0.113.5")).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    expect(init.method).toBe("POST");
    const body = String(init.body);
    expect(body).toContain("secret=sec-1");
    expect(body).toContain("response=tok-1");
    expect(body).toContain("remoteip=203.0.113.5");
  });

  it("success=false 时透传 error-codes", async () => {
    stubFetch({ success: false, "error-codes": ["invalid-input-response", "timeout-or-duplicate"] });
    const result = await verifyTurnstileToken("tok", "sec");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid-input-response,timeout-or-duplicate");
  });

  it("success=false 且无错误码时回落 unknown", async () => {
    stubFetch({ success: false });
    const result = await verifyTurnstileToken("tok", "sec");
    expect(result).toEqual({ ok: false, error: "unknown" });
  });

  it("HTTP 非 200 视为不可用", async () => {
    stubFetch({ success: true }, 500);
    const result = await verifyTurnstileToken("tok", "sec");
    expect(result).toEqual({ ok: false, error: "http-500" });
  });

  it("网络异常不抛出，返回错误信息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect timeout");
      })
    );
    const result = await verifyTurnstileToken("tok", "sec");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("connect timeout");
  });
});
