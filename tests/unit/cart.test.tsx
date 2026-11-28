import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CartItem, useCart } from "@/components/shop/cart";

// Exercise the provider's client snapshot without a DOM rendering dependency.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => CartItem[]) => getSnapshot(),
}));

const item = { slug: "basic", name: "基础版", inStock: true, priceCents: 100 };

async function cartFrom(storage: Pick<Storage, "setItem" | "getItem">) {
  vi.stubGlobal("window", { localStorage: storage });
  const cart = await import("@/components/shop/cart");
  let snapshot: ReturnType<typeof useCart>;
  function Observe() {
    snapshot = cart.useCart();
    return null;
  }
  return () => {
    renderToStaticMarkup(<cart.CartProvider><Observe /></cart.CartProvider>);
    return snapshot;
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("购物车", () => {
  it("读取旧数据时过滤无效行，按实际订单扣除数量并保留其他标签页的加购", async () => {
    let raw = JSON.stringify([null, { ...item, quantity: 2 }, { ...item, quantity: "3" }]);
    const getCart = await cartFrom({ getItem: () => raw, setItem: (_key, value) => { raw = value; } });
    expect(getCart().count).toBe(2);
    const checkout = getCart();
    const other = { ...item, slug: "pro", name: "专业版", quantity: 1 };
    raw = JSON.stringify([{ ...item, quantity: 3 }, other]);
    checkout.removePurchased([{ slug: item.slug, quantity: 2 }]);
    expect(JSON.parse(raw)).toEqual([{ ...item, quantity: 1 }, other]);
  });

  it("浏览器拒绝写入存储后，本页后续加购与移除继续使用内存", async () => {
    const getCart = await cartFrom({
      getItem: () => null,
      setItem: () => { throw new Error("storage unavailable"); },
    });
    getCart().add(item, 1);
    getCart().add(item, 2);
    expect(getCart().count).toBe(3);
    getCart().remove(item.slug);
    expect(getCart().items).toEqual([]);
  });
});
