import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getOrderWithItems } from "@/server/orders";
import { formatMoney } from "@/lib/money";
import { PayStatusActions } from "@/components/shop/pay-status";

export const metadata: Metadata = {
  title: "支付订单",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  pending: "待支付",
  paid: "已支付，交付中",
  completed: "已完成",
  closed: "已关闭",
  reconciling: "支付待核实",
};

export default async function PayPage({ params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params;
  const data = await getOrderWithItems(orderNo);
  if (!data) notFound();
  const { order, items, payment } = data;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="text-center">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">订单状态</h1>
        <p className="mt-1 text-sm text-muted">本页会自动刷新；支付完成后请勿关闭</p>
      </header>

      <section className="space-y-4 rounded-xl border border-line bg-surface p-6">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">状态</span>
          <span className="rounded-full border border-line px-2 py-0.5 text-xs">
            {STATUS_LABELS[order.status] ?? order.status}
          </span>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">订单号</dt>
            <dd className="font-mono">{order.orderNo}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">金额</dt>
            <dd className="font-semibold">{formatMoney(order.totalCents, order.currency)}</dd>
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
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-success">
            支付完成，卡密已交付。请到「订单查询」页凭订单号 + 邮箱 + 查单密码查看；交付内容也已发送至你的邮箱。
          </p>
        ) : null}
        {order.status === "reconciling" ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            支付渠道响应超时，订单已保留待人工核实，请勿重复支付；如有疑问请联系客服。
          </p>
        ) : null}
        <PayStatusActions orderNo={order.orderNo} status={order.status} paymentUrl={payment?.paymentUrl ?? null} />
      </section>
    </div>
  );
}
