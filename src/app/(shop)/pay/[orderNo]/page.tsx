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

const STATUS_META: Record<
  string,
  { label: string; tone: "neutral" | "green" | "yellow" | "blue"; subtitle: string }
> = {
  pending: { label: "待支付", tone: "neutral", subtitle: "页面每 5 秒自动刷新，付款确认后立即发卡。" },
  paid: { label: "已付款，发卡中", tone: "blue", subtitle: "已收到付款，正在分配卡密，请稍候刷新。" },
  completed: { label: "已完成", tone: "green", subtitle: "卡密已发放并同步至下单邮箱。" },
  closed: { label: "已关闭", tone: "neutral", subtitle: "订单已关闭，占用的卡密已退回库存。" },
  reconciling: { label: "待核实", tone: "yellow", subtitle: "收银台未返回明确结果，订单已保留待核实。" },
};

export default async function PayPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const data = await getOrderWithItems(orderNo);
  if (!data) notFound();
  const { order, items, payment } = data;
  const status = STATUS_META[order.status] ?? {
    label: order.status,
    tone: "neutral" as const,
    subtitle: "当前订单状态已更新。",
  };

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <header className="space-y-2 border-b border-line pb-6">
        <p className="eyebrow">订单状态</p>
        <h1 className="text-3xl font-semibold tracking-[-0.025em]">{status.label}</h1>
        <p className="text-sm leading-6 text-muted">{status.subtitle}</p>
      </header>

      <section className="space-y-6 rounded-md border border-line bg-surface p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">状态</span>
          <Badge tone={status.tone} live={order.status === "pending" || order.status === "paid"}>{status.label}</Badge>
        </div>

        <dl className="divide-y divide-line rounded-sm border border-line text-sm">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-muted">订单号</dt>
            <dd className="font-mono">{order.orderNo}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-muted">金额</dt>
            <dd className="text-lg font-semibold"><span className="data">{formatMoney(order.totalCents)}</span></dd>
          </div>
          {order.expiresAt && order.status === "pending" ? (
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-muted">付款截止</dt>
              <dd>{order.expiresAt.toLocaleString("zh-CN")}</dd>
            </div>
          ) : null}
        </dl>

        <ul className="divide-y divide-line overflow-hidden rounded-sm border border-line text-sm">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <span>
                {i.productName} × {i.quantity}
              </span>
              <span className="text-muted"><span className="data">{formatMoney(i.lineTotalCents)}</span></span>
            </li>
          ))}
        </ul>

        {order.status === "paid" ? (
          <p className="rounded-sm border border-tint-blue-fg/25 bg-tint-blue px-4 py-3 text-sm leading-6 text-tint-blue-fg">
            已确认收款，系统正在处理发卡。若长时间未更新，请联系客服核对。
          </p>
        ) : null}

        {order.status === "completed" ? (
          <p className="rounded-sm border border-tint-green-fg/25 bg-tint-green px-4 py-3 text-sm leading-6 text-tint-green-fg">
            卡密已发送到下单邮箱。如需在网页查看，请前往「订单查询」并输入订单号、下单邮箱和查单密码。
          </p>
        ) : null}

        {order.status === "reconciling" ? (
          <p className="rounded-sm border border-tint-yellow-fg/25 bg-tint-yellow px-4 py-3 text-sm leading-6 text-tint-yellow-fg">
            收银台未返回明确结果，订单已保留待核实。请勿重复付款，核实完成后状态将自动更新。
          </p>
        ) : null}

        {order.status === "closed" ? (
          <p className="rounded-sm border border-line bg-surface-2 px-4 py-3 text-sm leading-6 text-muted">
            订单已关闭，占用的卡密已退回库存。如需购买，请重新下单。
          </p>
        ) : null}

        <PayStatusActions orderNo={order.orderNo} status={order.status} paymentUrl={payment?.paymentUrl ?? null} />
      </section>
    </div>
  );
}
