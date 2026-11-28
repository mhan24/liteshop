"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

/**
 * 轻量购物车：localStorage 持久化，useSyncExternalStore 订阅
 * （服务端快照恒为空数组 → 无水合不匹配；价格只是展示快照，结算金额一律由服务端重算）。
 */

export interface CartItem {
  slug: string;
  name: string;
  priceCents: number;
  quantity: number;
  inStock: boolean;
}

const STORAGE_KEY = "liteshop_cart_v1";
const EMPTY: CartItem[] = [];

let memory: CartItem[] = EMPTY;
let cachedRaw: string | null = null;
let memoryOnly = false;
const listeners = new Set<() => void>();

function isCartItem(value: unknown): value is CartItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CartItem>;
  return typeof item.slug === "string" && item.slug.length > 0 && typeof item.name === "string"
    && typeof item.priceCents === "number" && Number.isSafeInteger(item.priceCents) && item.priceCents >= 0
    && typeof item.quantity === "number" && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= 99
    && typeof item.inStock === "boolean";
}

function read(): CartItem[] {
  if (memoryOnly || typeof window === "undefined") return memory;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    memoryOnly = true;
    return memory;
  }
  if (raw === cachedRaw) return memory;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw && JSON.parse(raw);
    memory = Array.isArray(parsed) ? parsed.filter(isCartItem) : EMPTY;
  } catch {
    memory = EMPTY;
  }
  return memory;
}

function write(next: CartItem[]): void {
  memory = next;
  if (!memoryOnly) {
    try {
      cachedRaw = JSON.stringify(next);
      window.localStorage.setItem(STORAGE_KEY, cachedRaw);
    } catch {
      memoryOnly = true;
    }
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("storage", onStorage);
    listeners.delete(listener);
  };
}

function getServerSnapshot(): CartItem[] {
  return EMPTY;
}

interface CartContextValue {
  items: CartItem[];
  add: (item: Omit<CartItem, "quantity">, quantity: number) => void;
  setQuantity: (slug: string, quantity: number) => void;
  remove: (slug: string) => void;
  clear: () => void;
  removePurchased: (lines: { slug: string; quantity: number }[]) => void;
  count: number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const items = useSyncExternalStore(subscribe, read, getServerSnapshot);

  const add = useCallback((item: Omit<CartItem, "quantity">, quantity: number) => {
    quantity = Math.min(99, Math.max(1, Math.trunc(quantity) || 1));
    const prev = read();
    const existing = prev.find((i) => i.slug === item.slug);
    const next = existing
      ? prev.map((i) =>
          i.slug === item.slug ? { ...i, quantity: Math.min(99, i.quantity + quantity) } : i
        )
      : [...prev, { ...item, quantity }];
    write(next);
  }, []);

  const setQuantity = useCallback((slug: string, quantity: number) => {
    const prev = read();
    write(
      quantity <= 0
        ? prev.filter((i) => i.slug !== slug)
        : prev.map((i) => (i.slug === slug ? { ...i, quantity: Math.min(99, Math.max(1, Math.trunc(quantity) || 1)) } : i))
    );
  }, []);

  const remove = useCallback((slug: string) => {
    write(read().filter((i) => i.slug !== slug));
  }, []);

  const clear = useCallback(() => write([]), []);

  const removePurchased = useCallback((lines: { slug: string; quantity: number }[]) => {
    const purchased = new Map(lines.map((line) => [line.slug, line.quantity]));
    write(read().flatMap((item) => {
      const remaining = item.quantity - (purchased.get(item.slug) ?? 0);
      return remaining > 0 ? [{ ...item, quantity: remaining }] : [];
    }));
  }, []);

  const count = useMemo(() => items.reduce((acc, i) => acc + i.quantity, 0), [items]);

  const value = useMemo(
    () => ({ items, add, setQuantity, remove, clear, removePurchased, count }),
    [items, add, setQuantity, remove, clear, removePurchased, count]
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart 必须在 CartProvider 内使用");
  return ctx;
}
