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
    <div className="mx-auto max-w-md space-y-5 rounded-md border border-line bg-surface p-8">
      <p className="eyebrow">开发环境</p>
      <h1 className="text-xl font-semibold tracking-[-0.01em]">模拟收银台</h1>
      <p className="text-sm leading-6 text-muted">
        订单 <span className="font-mono">{orderNo}</span>。点击下方按钮将模拟发送支付成功回调，用于本地验证回调与发卡流程。
      </p>
      <form action={mockPayAction}>
        <input type="hidden" name="orderNo" value={orderNo} />
        <input type="hidden" name="ref" value={ref} />
        <input type="hidden" name="status" value="2" />
        <button
          type="submit"
          className="h-10 w-full rounded-sm bg-accent text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover active:scale-[0.98]"
        >
          模拟支付成功
        </button>
      </form>
    </div>
  );
}
