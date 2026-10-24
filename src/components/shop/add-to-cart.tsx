"use client";

import { useState } from "react";
import { useCart } from "./cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** 商品详情页的加购控件 */
export function AddToCart({ slug, name, priceCents, inStock }: { slug: string; name: string; priceCents: number; inStock: boolean }) {
  const { add } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  if (!inStock) {
    return <p className="text-sm text-muted">暂时缺货，补货后即可购买。</p>;
  }

  return (
    <div className="flex items-center gap-3">
      <Input
        type="number"
        min={1}
        max={99}
        value={quantity}
        onChange={(e) => setQuantity(Math.min(99, Math.max(1, Number(e.target.value))))}
        aria-label="购买数量"
        className="w-24"
      />
      <Button
        type="button"
        onClick={() => {
          add({ slug, name, priceCents, inStock }, quantity);
          setAdded(true);
          setTimeout(() => setAdded(false), 2000);
        }}
      >
        {added ? "已加入购物车" : "加入购物车"}
      </Button>
    </div>
  );
}
