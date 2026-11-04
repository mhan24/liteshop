"use client";

import Link from "next/link";
import { useCart } from "./cart";

/** 顶栏购物车入口：数量只在客户端显示，避免与服务端快照冲突 */
export function CartLink() {
  const { count } = useCart();
  return (
    <Link href="/cart" className="transition-colors hover:text-fg">
      购物车
      {count > 0 ? (
        <span className="ml-1.5 font-mono text-xs text-fg">{count}</span>
      ) : null}
    </Link>
  );
}
