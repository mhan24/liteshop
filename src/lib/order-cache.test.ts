import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateOrderNo } from "@/lib/order-no";
import {
  clearCachedOrders,
  forgetOrder,
  readCachedOrders,
  rememberOrder,
  type CachedOrder,
} from "./order-cache";

/**
 * 本地订单缓存。
 *
 * 安全边界：缓存**只是输入便利**，不构成授权凭据。
 * 因此必须做到：只存最小必要信息、不存交付内容/支付地址、
 * 且被篡改时不会污染出非法订单号。
 */

const entry = (over: Partial<CachedOrder> = {}): CachedOrder => ({
  orderNo: generateOrderNo(),
  email: "buyer@example.com",
  productName: "测试商品",
  total: "$1.00",
  createdAt: new Date().toISOString(),
  ...over,
});

let store: Record<string, string>;

beforeEach(() => {
  store = {};
  // 测试环境为 node（无 window/localStorage），这里显式提供浏览器侧依赖。
  // 模块里用的是 `window.localStorage`，因此两者需指向同一个对象。
  const ls = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
  vi.stubGlobal("localStorage", ls);
  vi.stubGlobal("window", { localStorage: ls } as unknown as Window & typeof globalThis);
});

afterEach(() => vi.unstubAllGlobals());

describe("订单本地缓存", () => {
  it("写入后可读回", () => {
    const e = entry();
    rememberOrder(e);
    expect(readCachedOrders()).toHaveLength(1);
    expect(readCachedOrders()[0].orderNo).toBe(e.orderNo);
  });

  it("新记录置顶，同订单号不重复", () => {
    const a = entry();
    const b = entry();
    rememberOrder(a);
    rememberOrder(b);
    rememberOrder(entry({ orderNo: a.orderNo, total: "$9.99" }));
    const list = readCachedOrders();
    expect(list).toHaveLength(2);
    // 同订单号更新而非新增
    expect(list.filter((o) => o.orderNo === a.orderNo)).toHaveLength(1);
    expect(list[0].orderNo).toBe(a.orderNo);
  });

  it("超过上限时丢弃最旧的", () => {
    for (let i = 0; i < 30; i++) rememberOrder(entry());
    const list = readCachedOrders();
    expect(list.length).toBeLessThanOrEqual(20);
  });

  it("只存最小信息：不含交付内容与支付地址", () => {
    const e = entry();
    rememberOrder(e);
    const raw = JSON.stringify(readCachedOrders());
    expect(raw).not.toContain("deliveryContent");
    expect(raw).not.toContain("paymentUrl");
    expect(raw).not.toContain("cfToken");
  });

  it("非法的缓存条目被丢弃（订单号必须通过校验位验证）", () => {
    // 模拟被篡改的 localStorage
    store["liteshop.orders.v1"] = JSON.stringify([
      { orderNo: "LS-FAKE", email: "a@b.c", productName: "x", total: "1", createdAt: "now" },
      { orderNo: '"; DROP TABLE orders; --', email: "a@b.c", productName: "x", total: "1", createdAt: "now" },
      entry(),
    ]);
    const list = readCachedOrders();
    expect(list).toHaveLength(1);
    expect(list[0].orderNo).toMatch(/^LS\d{8}/);
  });

  it("格式损坏的 JSON 不抛错，返回空列表", () => {
    store["liteshop.orders.v1"] = "{not json";
    expect(readCachedOrders()).toEqual([]);
    store["liteshop.orders.v1"] = '{"a":1}';
    expect(readCachedOrders()).toEqual([]);
  });

  it("localStorage 不可用（隐私模式/配额满）时静默降级", () => {
    const badLs = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    vi.stubGlobal("localStorage", badLs);
    vi.stubGlobal("window", { localStorage: badLs } as unknown as Window & typeof globalThis);
    expect(() => rememberOrder(entry())).not.toThrow();
    expect(readCachedOrders()).toEqual([]);
  });

  it("forgetOrder 按订单号移除；clearCachedOrders 清空", () => {
    const a = entry();
    const b = entry();
    rememberOrder(a);
    rememberOrder(b);
    forgetOrder(a.orderNo);
    expect(readCachedOrders().map((o) => o.orderNo)).toEqual([b.orderNo]);
    clearCachedOrders();
    expect(readCachedOrders()).toEqual([]);
  });

  it("非浏览器环境（SSR）安全返回空且不抛错", () => {
    vi.stubGlobal("window", undefined);
    expect(readCachedOrders()).toEqual([]);
    expect(() => rememberOrder(entry())).not.toThrow();
    expect(() => clearCachedOrders()).not.toThrow();
  });
});