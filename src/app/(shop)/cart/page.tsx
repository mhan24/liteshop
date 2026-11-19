import type { Metadata } from "next";
import { CartList } from "@/components/shop/cart-list";

export const metadata: Metadata = {
  title: "购物车",
  robots: { index: false, follow: false },
};

export default function CartPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2 border-b border-line pb-6">
        <p className="eyebrow">购物车</p>
        <h1 className="text-3xl font-semibold tracking-[-0.025em]">确认要买的东西</h1>
      </header>
      <CartList />
    </div>
  );
}
