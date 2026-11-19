"use client";

import Link from "next/link";
import { useCart } from "./cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";

/** 购物车列表：单价只是展示快照，结算金额由服务端按商品表重算 */
export function CartList() {
  const { items, setQuantity, remove, clear } = useCart();

  if (items.length === 0) {
    return (
      <div className="space-y-3 rounded-md border border-line bg-surface px-6 py-16 text-center">
        <p className="text-lg">购物车为空</p>
        <p className="text-sm text-muted">挑选商品加入购物车后，即可在此结算。</p>
        <p className="pt-2">
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-sm bg-accent px-5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover active:scale-[0.98]"
          >
            浏览商品
          </Link>
        </p>
      </div>
    );
  }

  const total = items.reduce((acc, i) => acc + i.priceCents * i.quantity, 0);

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
        {items.map((item) => (
          <li key={item.slug} className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-0 flex-1">
              <Link href={`/products/${item.slug}`} className="truncate text-sm font-medium hover:underline">
                {item.name}
              </Link>
              <p className="mt-1 font-mono text-xs text-muted">
                <span className="data">{formatMoney(item.priceCents)}</span> × {item.quantity} ={" "}
                <span className="data">{formatMoney(item.priceCents * item.quantity)}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={99}
                value={item.quantity}
                onChange={(e) => setQuantity(item.slug, Number(e.target.value) || 1)}
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

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button type="button" variant="ghost" onClick={clear}>
          清空购物车
        </Button>
        <div className="flex items-center gap-5">
          <span className="text-sm text-muted">
            合计 <span className="text-lg font-semibold text-fg"><span className="data">{formatMoney(total)}</span></span>
          </span>
          <Link
            href="/checkout"
            className="inline-flex h-10 items-center justify-center rounded-sm bg-accent px-6 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover active:scale-[0.98]"
          >
            去结算
          </Link>
        </div>
      </div>
      <p className="text-xs leading-5 text-muted">提交订单时将按商品当前价格重新计算应付金额。</p>
    </div>
  );
}
