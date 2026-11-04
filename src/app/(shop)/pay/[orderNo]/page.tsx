import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrderWithItems } from "@/server/orders";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/input";
import { PayStatusActions } from "@/components/shop/pay-status";

export const metadata: Metadata = {
  title: "订单状态",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { label: string; tone: "neutral" | "green" | "yellow" | "blue" }> = {
  pending: { label: "待支付", tone: "neutral" },
  paid: { label: "已付款，发卡中", tone: "blue" },
  completed: { label: "已完成", tone: "green" },
  closed: { label: "已关闭", tone: "neutral" },
  reconciling: { label: "待核实", tone: "yellow" },
};

export default async function PayPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const data = await getOrderWithItems(orderNo);
  if (!data) notFound();
  const { order, items, payment } = data;
  const status = STATUS_META[order.status] ?? { label: order.status, tone: "neutral" as const };

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <header className="space-y-2 border-b border-line pb-6">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted">订单状态</p>
        <h1 className="font-serif text-3xl font-semibold tracking-[-0.025em]">{status.label}</h1>
        <p className="text-sm leading-6 text-muted">
          {order.status === "pending"
            ? "页面每 5 秒刷新一次。付款被确认后会自动发卡。"
            : "这是当前订单的最新情况。"}
        </p>
      </header>

      <section className="space-y-6 rounded-xl border border-line bg-surface p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">状态</span>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>

        <dl className="divide-y divide-line rounded-lg border border-line text-sm">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-muted">订单号</dt>
            <dd className="font-mono">{order.orderNo}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-muted">金额</dt>
            <dd className="font-serif text-lg font-semibold">{formatMoney(order.totalCents)}</dd>
          </div>
          {order.expiresAt && order.status === "pending" ? (
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-muted">付款截止</dt>
              <dd>{order.expiresAt.toLocaleString("zh-CN")}</dd>
            </div>
          ) : null}
        </dl>

        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line text-sm">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <span>
                {i.productName} × {i.quantity}
              </span>
              <span className="text-muted">{formatMoney(i.lineTotalCents)}</span>
            </li>
          ))}
        </ul>

        {order.status === "completed" ? (
          <p className="rounded-lg border border-tint-green-fg/25 bg-tint-green px-4 py-3 text-sm leading-6 text-tint-green-fg">
            卡密已发放，同一份内容也发送到下单邮箱。之后可在「订单查询」用订单号、邮箱和查单密码再次查看。
          </p>
        ) : null}

        {order.status === "reconciling" ? (
          <p className="rounded-lg border border-tint-yellow-fg/25 bg-tint-yellow px-4 py-3 text-sm leading-6 text-tint-yellow-fg">
            收银台当时没有返回结果，订单被保留下来等核实。请不要重复付款；核实完成后这里会自动更新。
          </p>
        ) : null}

        <PayStatusActions orderNo={order.orderNo} status={order.status} paymentUrl={payment?.paymentUrl ?? null} />
      </section>
    </div>
  );
}
