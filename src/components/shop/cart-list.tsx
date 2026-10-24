"use client";

import Link from "next/link";
import { useCart } from "./cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";

/** 购物车列表（价格在结算时由服务端重算） */
export function CartList() {
  const { items, setQuantity, remove, clear, currency } = useCart();

  if (items.length === 0) {
    return (
      <div className="space-y-3 text-sm text-muted">
        <p>购物车是空的。</p>
        <Link href="/" className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg">
          去挑选商品
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {items.map((item) => (
          <li key={item.slug} className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <Link href={`/products/${item.slug}`} className="truncate text-sm font-medium hover:underline">
                {item.name}
              </Link>
              <p className="text-xs text-muted">{formatMoney(item.priceCents, currency)} × {item.quantity}</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={99}
                value={item.quantity}
                onChange={(e) => setQuantity(item.slug, Number(e.target.value))}
                aria-label={`${item.name} 数量`}
                className="w-20"
              />
              <Button type="button" variant="ghost" onClick={() => remove(item.slug)}>
                移除
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={clear}>
          清空购物车
        </Button>
        <Link
          href="/checkout"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-6 text-sm font-medium text-accent-fg hover:opacity-90"
        >
          去结算
        </Link>
      </div>
    </div>
  );
}
