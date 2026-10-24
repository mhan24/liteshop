import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { orders, settings } from "@/db/schema";
import { checkoutAction, queryOrderAction } from "@/actions/shop";
import { resetDb, seedAutoProduct, seedCurrency } from "../helpers";
import { SETTING_KEYS } from "@/server/settings";

/**
 * 人机验证闸门（action 层）：后台开启 Turnstile 后，
 * 下单/查单必须携带通过 siteverify 的一次性 token；
 * 降级开关仅对「空 token」放行。
 */

// checkoutAction/queryOrderAction 内部读取请求头（限流 IP）；IP 可按用例切换避免限流串扰
const state = vi.hoisted(() => ({ ip: "203.0.113.9" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": state.ip }),
}));

function stubSiteverify(success: boolean) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ success, "error-codes": success ? [] : ["invalid-input-response"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function enforceTurnstile(fallback: boolean) {
  await db.insert(settings).values([
    { key: SETTING_KEYS.turnstileEnabled, value: "1" },
    { key: SETTING_KEYS.turnstileSiteKey, value: "site-key" },
    { key: SETTING_KEYS.turnstileSecretKey, value: "secret-key" },
    { key: SETTING_KEYS.turnstileFallbackEnabled, value: fallback ? "1" : "0" },
  ]);
}

function checkoutForm(token?: string) {
  const fd = new FormData();
  fd.set("email", "buyer@test.dev");
  fd.set("items", JSON.stringify([{ slug: "p1", quantity: 1 }]));
  if (token !== undefined) fd.set("cfToken", token);
  return fd;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("下单人机验证（checkoutAction）", () => {
  beforeEach(async () => {
    await resetDb();
    await seedAutoProduct("p1", 5);
    await seedCurrency("USD");
  });

  it("未开启验证：无 token 正常下单（现状回归）", async () => {
    const fetchMock = stubSiteverify(true);
    const result = await checkoutAction(null, checkoutForm());
    expect(result.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("开启验证且未提供 token：拒绝，不触发 siteverify", async () => {
    await enforceTurnstile(false);
    const fetchMock = stubSiteverify(true);
    const result = await checkoutAction(null, checkoutForm());
    expect(result.ok).toBe(false);
    expect(result.message).toContain("人机验证");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("开启验证且 token 有效：放行并调用一次 siteverify", async () => {
    await enforceTurnstile(false);
    const fetchMock = stubSiteverify(true);
    const result = await checkoutAction(null, checkoutForm("good-token"));
    expect(result.ok).toBe(true);
    expect(result.data?.orderNo).toMatch(/^LS/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("开启验证且 siteverify 判失败：拒绝下单", async () => {
    await enforceTurnstile(false);
    stubSiteverify(false);
    const result = await checkoutAction(null, checkoutForm("bad-token"));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("人机验证");
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("降级开关开启：空 token 放行且不调 siteverify", async () => {
    await enforceTurnstile(true);
    const fetchMock = stubSiteverify(true);
    const result = await checkoutAction(null, checkoutForm(""));
    expect(result.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("查单人机验证（queryOrderAction）", () => {
  beforeEach(async () => {
    await resetDb();
    await seedAutoProduct("p1", 5);
    await seedCurrency("USD");
  });

  it("开启验证且未提供 token：拒绝查询", async () => {
    await enforceTurnstile(false);
    const fd = new FormData();
    fd.set("orderNo", "LS000000000000AAAAAA");
    fd.set("email", "buyer@test.dev");
    fd.set("password", "AAAAAAAA");
    const fetchMock = stubSiteverify(true);
    const result = await queryOrderAction(null, fd);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("人机验证");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("开启验证且 token 有效：进入正常查单流程（订单不存在返回三因子错误）", async () => {
    await enforceTurnstile(false);
    const fetchMock = stubSiteverify(true);
    const fd = new FormData();
    fd.set("orderNo", "LS000000000000AAAAAA");
    fd.set("email", "buyer@test.dev");
    fd.set("password", "AAAAAAAA");
    fd.set("cfToken", "good-token");
    const result = await queryOrderAction(null, fd);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("订单不存在");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
