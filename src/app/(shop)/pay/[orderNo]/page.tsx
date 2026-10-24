import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrderWithItems } from "@/server/orders";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/input";
import { PayStatusActions } from "@/components/shop/pay-status";

export const metadata: Metadata = {
  title: "支付订单",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { label: string; tone: "neutral" | "green" | "yellow" | "blue" }> = {
  pending: { label: "待支付", tone: "neutral" },
  paid: { label: "已支付，交付中", tone: "blue" },
  completed: { label: "已完成", tone: "green" },
  closed: { label: "已关闭", tone: "neutral" },
  reconciling: { label: "支付待核实", tone: "yellow" },
};

export default async function PayPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const data = await getOrderWithItems(orderNo);
  if (!data) notFound();
  const { order, items, payment } = data;
  const status = STATUS_META[order.status];

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="text-center">
        <h1 className="font-serif text-2xl font-semibold tracking-[-0.02em]">订单状态</h1>
        <p className="mt-1 text-sm text-muted">支付完成后，本页会自动更新为交付结果。</p>
      </header>

      <section className="space-y-5 rounded-xl border border-line bg-surface p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">当前状态</span>
          <Badge tone={status?.tone ?? "neutral"}>{status?.label ?? order.status}</Badge>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">订单号</dt>
            <dd className="font-mono">{order.orderNo}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">金额</dt>
            <dd className="font-serif text-lg font-semibold tracking-tight">
              {formatMoney(order.totalCents, order.currency)}
            </dd>
          </div>
          {order.expiresAt && order.status === "pending" ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted">支付有效期至</dt>
              <dd>{order.expiresAt.toLocaleString("zh-CN")}</dd>
            </div>
          ) : null}
        </dl>
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-4 p-3">
              <span>
                {i.productName} × {i.quantity}
              </span>
              <span className="text-muted">{formatMoney(i.lineTotalCents, order.currency)}</span>
            </li>
          ))}
        </ul>
        {order.status === "completed" ? (
          <p className="rounded-lg border border-tint-green-fg/25 bg-tint-green px-3 py-2.5 text-sm leading-6 text-tint-green-fg">
            支付完成，卡密已发放。可在「订单查询」页凭订单号、邮箱与查单密码随时查看；内容也已同步发送至你的邮箱。
          </p>
        ) : null}
        {order.status === "reconciling" ? (
          <p className="rounded-lg border border-tint-yellow-fg/25 bg-tint-yellow px-3 py-2.5 text-sm leading-6 text-tint-yellow-fg">
            支付结果正在核实，订单已保留，请勿重复付款。核实完成后本页会自动更新；如有疑问请联系客服。
          </p>
        ) : null}
        <PayStatusActions orderNo={order.orderNo} status={order.status} paymentUrl={payment?.paymentUrl ?? null} />
      </section>
    </div>
  );
}
