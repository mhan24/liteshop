import type { Metadata } from "next";
import { CartList } from "@/components/shop/cart-list";

export const metadata: Metadata = {
  title: "购物车",
  robots: { index: false, follow: false },
};

export default function CartPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-semibold tracking-tight">购物车</h1>
      <CartList />
    </div>
  );
}
