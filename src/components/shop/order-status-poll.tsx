"use client";

import { useEffect, useRef, useState, useActionState } from "react";
import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cancelOrderAction,
  resumePaymentAction,
  type CancelOrderState,
  type ResumePaymentState,
} from "@/actions/shop";
import { openPaymentWindow, toAbsoluteUrl } from "@/lib/open-payment-window";

interface OrderStatusPayload {
  orderNo: string;
  status: string;
  statusLabel: string;
  productName: string;
  quantity: number;
  total: string;
  emailMasked: string;
  /** 仅 pending 提供：继续支付入口 */
  paymentUrl?: string | null;
  expiresAtText?: string | null;
}

/** 回跳页状态轮询：2s 间隔，completed/expired/closed 停止 */
export function OrderStatusPoll({
  orderNo,
  initial,
  payCTA = false,
}: {
  orderNo: string;
  initial: OrderStatusPayload | null;
  /** 待支付页模式：pending 时显示前往收银台按钮 */
  payCTA?: boolean;
}) {
  const [order, setOrder] = useState<OrderStatusPayload | null>(initial);
  const [notFound, setNotFound] = useState(!initial);

  useEffect(() => {
    if (!orderNo) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch(`/api/orders/status?order_no=${encodeURIComponent(orderNo)}`);
        if (res.ok) {
          const json = (await res.json()) as { ok: boolean; order?: OrderStatusPayload };
          if (json.ok && json.order) {
            setOrder(json.order);
            setNotFound(false);
            if (!["pending", "paid", "delivering"].includes(json.order.status)) return; // 终态停轮询
          }
        } else if (res.status === 404) {
          setNotFound(true);
          return;
        }
      } catch {
        // 网络抖动继续重试
      }
      if (!stopped) timer = setTimeout(tick, 2000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [orderNo]);

  if (notFound) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <p className="font-serif text-xl">没有找到订单</p>
        <p className="mt-2 text-sm text-muted-foreground">请检查订单号是否正确</p>
      </div>
    );
  }
  if (!order) return null;

  const done = ["completed", "expired", "closed"].includes(order.status);

  return (
    <div className="rounded-xl border border-border bg-card p-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-2xl tracking-tight">订单状态</h1>
        <StatusBadge status={order.status} label={order.statusLabel} />
      </div>
      <dl className="mt-6 space-y-3 text-sm">
        <Row label="订单号">
          <span className="font-mono text-xs">{order.orderNo}</span>
        </Row>
        <Row label="商品">
          {order.productName} × {order.quantity}
        </Row>
        <Row label="金额">
          <span className="font-mono">{order.total}</span>
        </Row>
        <Row label="邮箱">{order.emailMasked}</Row>
        {order.expiresAtText ? <Row label="支付有效期至">{order.expiresAtText}</Row> : null}
      </dl>

      <div className="mt-6 rounded-lg bg-secondary p-4 text-sm leading-relaxed">
        {order.status === "completed" ? (
          <>
            支付已确认，商品已交付。前往
            <a href="/orders" className="mx-1 font-medium underline underline-offset-4">
              订单查询
            </a>
            ，凭订单号和邮箱查看卡密 / 交付内容。
          </>
        ) : order.status === "pending" ? (
          <>等待支付确认中，本页会自动刷新；支付完成后请勿关闭本页。</>
        ) : order.status === "paid" ? (
          <>支付已到账，订单处理中，请稍后回到本页或前往订单查询。</>
        ) : order.status === "delivering" ? (
          <>支付已到账，正在为你发货；如卡密紧张可能稍有延迟。</>
        ) : order.status === "expired" ? (
          <>订单已超时未支付。如已付款请联系客服核实；如需继续购买可重新发起支付。</>
        ) : (
          <>订单已关闭。如已付款请联系客服核实。</>
        )}
      </div>

      {order.status === "pending" && payCTA && order.paymentUrl ? (
        <button
          type="button"
          onClick={() => openPaymentWindow(toAbsoluteUrl(order.paymentUrl!))}
          className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-[#333333] active:scale-[0.98]"
        >
          前往收银台支付
        </button>
      ) : null}

      {order.status === "pending" && payCTA ? (
        <CancelOrder orderNo={order.orderNo} />
      ) : null}

      {order.status === "expired" && payCTA ? <ResumePayment orderNo={order.orderNo} /> : null}

      {done ? (
        <a
          href="/orders"
          className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-[#333333] active:scale-[0.98]"
        >
          前往订单查询取货
        </a>
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/** 买家自助取消：仅待支付订单；需邮箱二次确认，成功后状态轮询会自动刷新 */
function CancelOrder({ orderNo }: { orderNo: string }) {
  const [state, formAction, pending] = useActionState<CancelOrderState | null, FormData>(
    cancelOrderAction,
    null
  );
  const [asking, setAsking] = useState(false);

  if (state?.ok) {
    return <p className="mt-4 text-center text-sm text-muted-foreground">{state.message}</p>;
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-md border border-border bg-transparent text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        取消订单
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-4 space-y-3 rounded-lg border border-border p-4">
      <input type="hidden" name="orderNo" value={orderNo} />
      <p className="text-sm text-muted-foreground">
        取消后订单将关闭，已锁定的库存会被释放。请填写下单邮箱以确认。
      </p>
      <Input
        name="email"
        type="email"
        required
        placeholder="下单时填写的邮箱"
        autoComplete="email"
      />
      {state?.error ? <p className="text-sm text-pastel-red-text">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="outline" className="flex-1" disabled={pending}>
          {pending ? "正在取消…" : "确认取消订单"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="flex-1"
          onClick={() => setAsking(false)}
          disabled={pending}
        >
          返回
        </Button>
      </div>
    </form>
  );
}

/** 过期订单重新发起支付：需邮箱确认归属，成功后在新窗口打开收银台 */
function ResumePayment({ orderNo }: { orderNo: string }) {
  const [state, formAction, pending] = useActionState<ResumePaymentState | null, FormData>(
    resumePaymentAction,
    null
  );
  const [asking, setAsking] = useState(false);
  const openedRef = useRef(false);

  // 重新发起成功后自动打开收银台（仅在状态变化时触发一次）
  useEffect(() => {
    if (state?.ok && state.paymentUrl && !openedRef.current) {
      openedRef.current = true;
      openPaymentWindow(toAbsoluteUrl(state.paymentUrl));
    }
  }, [state]);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-[#333333] active:scale-[0.98]"
      >
        重新发起支付
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-4 space-y-3 rounded-lg border border-border p-4">
      <input type="hidden" name="orderNo" value={orderNo} />
      <p className="text-sm text-muted-foreground">
        将为你生成新的支付地址（原地址已失效）。请填写下单邮箱以确认。
      </p>
      <Input name="email" type="email" required placeholder="下单时填写的邮箱" autoComplete="email" />
      {state?.error ? <p className="text-sm text-pastel-red-text">{state.error}</p> : null}
      {state?.ok ? <p className="text-sm text-muted-foreground">已生成新支付地址，正在打开收银台…</p> : null}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={pending}>
          {pending ? "正在重新发起…" : "确认并前往支付"}
        </Button>
        <Button type="button" variant="ghost" className="flex-1" onClick={() => setAsking(false)} disabled={pending}>
          返回
        </Button>
      </div>
    </form>
  );
}
