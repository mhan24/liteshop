"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

/**
 * 轻量购物车：localStorage 持久化，useSyncExternalStore 订阅
 * （服务端快照恒为空数组 → 无水合不匹配；价格仅为展示快照，结算金额由服务端重算）。
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

let memory: CartItem[] | null = null;
const listeners = new Set<() => void>();

function read(): CartItem[] {
  if (memory) return memory;
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      memory = raw ? (JSON.parse(raw) as CartItem[]) : [];
    } catch {
      memory = [];
    }
  }
  return memory ?? EMPTY;
}

function write(next: CartItem[]): void {
  memory = next;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
  count: number;
  currency: string;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children, currency }: { children: React.ReactNode; currency: string }) {
  const items = useSyncExternalStore(subscribe, read, getServerSnapshot);

  const add = useCallback((item: Omit<CartItem, "quantity">, quantity: number) => {
    const prev = read();
    const existing = prev.find((i) => i.slug === item.slug);
    const next = existing
      ? prev.map((i) =>
          i.slug === item.slug ? { ...i, quantity: Math.min(99, i.quantity + quantity) } : i
        )
      : [...prev, { ...item, quantity: Math.min(99, Math.max(1, quantity)) }];
    write(next);
  }, []);

  const setQuantity = useCallback((slug: string, quantity: number) => {
    const prev = read();
    write(
      quantity <= 0
        ? prev.filter((i) => i.slug !== slug)
        : prev.map((i) => (i.slug === slug ? { ...i, quantity: Math.min(99, quantity) } : i))
    );
  }, []);

  const remove = useCallback((slug: string) => {
    write(read().filter((i) => i.slug !== slug));
  }, []);

  const clear = useCallback(() => write([]), []);

  const count = useMemo(() => items.reduce((acc, i) => acc + i.quantity, 0), [items]);

  const value = useMemo(
    () => ({ items, add, setQuantity, remove, clear, count, currency }),
    [items, add, setQuantity, remove, clear, count, currency]
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart 必须在 CartProvider 内使用");
  return ctx;
}
