"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "./cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** 商品详情页的加购控件：数量 + 加入购物车 + 直接去结算 */
export function AddToCart({
  slug,
  name,
  priceCents,
  inStock,
}: {
  slug: string;
  name: string;
  priceCents: number;
  inStock: boolean;
}) {
  const { add } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  if (!inStock) {
    return (
      <div className="space-y-3">
        <Button type="button" disabled className="w-full">
          暂时缺货
        </Button>
        <p className="text-xs leading-5 text-muted">卡密用完会立即显示缺货，补货后即可下单。</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Input
          type="number"
          min={1}
          max={99}
          value={quantity}
          onChange={(e) => setQuantity(Math.min(99, Math.max(1, Number(e.target.value) || 1)))}
          aria-label="购买数量"
          className="w-24"
        />
        <Button
          type="button"
          className="flex-1"
          onClick={() => {
            add({ slug, name, priceCents, inStock }, quantity);
            setAdded(true);
            setTimeout(() => setAdded(false), 2000);
          }}
        >
          {added ? "已加入购物车" : "加入购物车"}
        </Button>
      </div>
      <Link
        href="/cart"
        className="inline-flex h-10 w-full items-center justify-center rounded-md border border-line text-sm font-medium transition-colors hover:bg-surface-2 active:scale-[0.98]"
      >
        去购物车结算
      </Link>
    </div>
  );
}
