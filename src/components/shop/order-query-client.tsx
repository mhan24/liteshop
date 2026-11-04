"use client";

import { useActionState, useState } from "react";
import { queryOrderAction, type QuerySuccess } from "@/actions/shop";
import { TurnstileWidget } from "./turnstile-widget";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import type { TurnstileClientConfig } from "@/server/settings";

const STATUS_META: Record<string, { label: string; tone: "neutral" | "green" | "yellow" | "blue" }> = {
  pending: { label: "待支付", tone: "neutral" },
  paid: { label: "已付款，发卡中", tone: "blue" },
  completed: { label: "已完成", tone: "green" },
  closed: { label: "已关闭", tone: "neutral" },
  reconciling: { label: "待核实", tone: "yellow" },
};

export function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, tone: "neutral" as const };
}

/** 订单查询表单 + 结果（订单号 + 邮箱 + 查单密码三因子） */
export function OrderQueryClient({ human }: { human: TurnstileClientConfig }) {
  const [state, formAction, pending] = useActionState(queryOrderAction, null);
  const [cfToken, setCfToken] = useState("");
  const [verifyKey, setVerifyKey] = useState(0);

  // 查询失败后 token 已被消费：清空并重挂 widget（渲染期调整模式）
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state && !state.ok) {
      setCfToken("");
      setVerifyKey((k) => k + 1);
    }
  }

  return (
    <div className="space-y-8">
      <form action={formAction} className="space-y-5 rounded-xl border border-line bg-surface p-6 sm:p-8">
        <div className="space-y-1.5">
          <Label htmlFor="q-orderNo">订单号</Label>
          <Input id="q-orderNo" name="orderNo" required placeholder="LS 开头的订单号" className="font-mono" />
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
            placeholder="建单时显示的 8 位密码"
            className="font-mono uppercase tracking-[0.2em]"
          />
        </div>

        {state && !state.ok ? (
          <p
            role="alert"
            className="rounded-lg border border-tint-red-fg/25 bg-tint-red px-3 py-2 text-sm text-tint-red-fg"
          >
            {state.message}
          </p>
        ) : null}

        {human.enabled ? (
          <div className="space-y-1.5">
            <Label>人机验证</Label>
            <TurnstileWidget key={verifyKey} siteKey={human.siteKey} onToken={setCfToken} />
            <input type="hidden" name="cfToken" value={cfToken} />
            {human.fallback ? (
              <p className="text-xs text-muted">验证组件加载失败时仍可查询，查询频率限制仍然生效。</p>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "查询中…" : "查询"}
        </Button>
      </form>

      {state?.ok && state.data ? <QueryResult data={state.data} /> : null}
    </div>
  );
}

function QueryResult({ data }: { data: QuerySuccess }) {
  const { order, totalDisplay } = data;
  const status = statusMeta(order.status);

  return (
    <section className="space-y-6 rounded-xl border border-line bg-surface p-6 sm:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <span className="font-mono text-sm">{order.orderNo}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </header>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">金额</dt>
          <dd className="font-semibold">{totalDisplay}</dd>
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

      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {order.items.map((item) => (
          <li key={item.productName} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span>
              {item.productName} × {item.quantity}
            </span>
            <span className="text-muted">{formatMoney(item.lineTotalCents)}</span>
          </li>
        ))}
      </ul>

      {order.deliveryContent ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">卡密内容</h3>
          <pre className="select-all whitespace-pre-wrap break-all rounded-lg border border-line bg-bg p-4 font-mono text-sm leading-6">
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
          className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover active:scale-[0.98]"
        >
          继续付款
        </a>
      ) : null}

      {order.status === "closed" ? (
        <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-xs leading-5 text-muted">
          订单已关闭，卡密已退回库存。需要的话重新下单即可。
        </p>
      ) : null}
    </section>
  );
}
