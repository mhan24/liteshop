import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { mockPayAction } from "@/actions/shop";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** 本地模拟收银台（仅 PAYMENT_DRIVER=mock） */
export default async function MockPayPage({
  searchParams,
}: {
  searchParams: Promise<{ order_no?: string; ref?: string }>;
}) {
  if (env.PAYMENT_DRIVER !== "mock") notFound();
  const { order_no: orderNo, ref } = await searchParams;
  if (!orderNo || !ref) notFound();

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="font-serif text-xl font-semibold">模拟收银台（开发环境）</h1>
      <p className="text-sm text-muted">
        订单 {orderNo} —— 点击下方按钮模拟支付成功回调，验证完整发卡链路。
      </p>
      <form action={mockPayAction}>
        <input type="hidden" name="orderNo" value={orderNo} />
        <input type="hidden" name="ref" value={ref} />
        <input type="hidden" name="status" value="2" />
        <button
          type="submit"
          className="h-10 w-full rounded-lg bg-accent text-sm font-medium text-accent-fg hover:opacity-90"
        >
          模拟支付成功
        </button>
      </form>
    </div>
  );
}
