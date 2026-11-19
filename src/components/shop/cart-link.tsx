"use client";

import Link from "next/link";
import { useCart } from "./cart";

/** 顶栏购物车入口：数量只在客户端显示（信号青小徽标），避免与服务端快照冲突 */
export function CartLink() {
  const { count } = useCart();
  return (
    <Link href="/cart" className="inline-flex items-center gap-1.5 transition-colors hover:text-fg">
      购物车
      {count > 0 ? (
        <span className="data inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-accent-fg">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
