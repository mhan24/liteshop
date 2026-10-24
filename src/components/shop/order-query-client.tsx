"use client";

import { useActionState } from "react";
import { queryOrderAction, type QuerySuccess } from "@/actions/shop";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";

/** 订单查询表单 + 结果（邮箱 + 订单号 + 查单密码三因子） */
export function OrderQueryClient() {
  const [state, formAction, pending] = useActionState(queryOrderAction, null);

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4 rounded-xl border border-line bg-surface p-6">
        <div className="space-y-1.5">
          <Label htmlFor="q-orderNo">订单号</Label>
          <Input id="q-orderNo" name="orderNo" required placeholder="LS…" className="font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-email">下单邮箱</Label>
          <Input id="q-email" name="email" type="email" required placeholder="you@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-password">查单密码</Label>
          <Input
            id="q-password"
            name="password"
            required
            maxLength={8}
            placeholder="下单时显示的 8 位密码"
            className="font-mono uppercase tracking-widest"
          />
        </div>
        {state && !state.ok ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
            {state.message}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "查询中…" : "查询订单"}
        </Button>
      </form>

      {state?.ok && state.data ? <QueryResult data={state.data} /> : null}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待支付",
  paid: "已支付，交付中",
  completed: "已完成",
  closed: "已关闭",
  reconciling: "支付待核实",
};

function QueryResult({ data }: { data: QuerySuccess }) {
  const { order, totalDisplay } = data;
  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-6">
      <header className="flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold">订单 {order.orderNo}</h2>
        <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </header>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">金额</dt>
          <dd>{totalDisplay}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted">下单时间</dt>
          <dd>{order.createdAt.toLocaleString("zh-CN")}</dd>
        </div>
        {order.completedAt ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">完成时间</dt>
            <dd>{order.completedAt.toLocaleString("zh-CN")}</dd>
          </div>
        ) : null}
      </dl>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {order.items.map((item) => (
          <li key={item.productName} className="flex items-center justify-between gap-4 p-3 text-sm">
            <span>
              {item.productName} × {item.quantity}
            </span>
            <span className="text-muted">{formatMoney(item.lineTotalCents, order.currency)}</span>
          </li>
        ))}
      </ul>

      {order.deliveryContent ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">交付内容</h3>
          <pre className="select-all whitespace-pre-wrap break-all rounded-lg border border-line bg-bg p-4 font-mono text-sm">
            {order.deliveryContent}
          </pre>
          <Button
            type="button"
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(order.deliveryContent ?? "")}
          >
            复制全部
          </Button>
        </div>
      ) : null}

      {order.status === "pending" && order.paymentUrl ? (
        <a
          href={order.paymentUrl}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg"
        >
          继续支付
        </a>
      ) : null}
    </section>
  );
}
