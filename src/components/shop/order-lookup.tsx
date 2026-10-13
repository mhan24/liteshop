"use client";

import { useState, useActionState } from "react";
import { lookupOrderAction, type LookupState } from "@/actions/shop";
import { TurnstileWidget, useTurnstileToken } from "@/components/shop/turnstile-widget";
import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearCachedOrders, readCachedOrders, type CachedOrder } from "@/lib/order-cache";
import { CancelOrder } from "@/components/shop/order-status-poll";

/** 查单（订单号 + 邮箱 + 人机验证）：结果由 Server Action 校验后返回 */
export function OrderLookupClient({
  turnstile,
}: {
  turnstile?: { enabled: boolean; siteKey: string };
}) {
  const [state, formAction, pending] = useActionState<LookupState | null, FormData>(
    lookupOrderAction,
    null
  );
  const { token, setToken, resetToken } = useTurnstileToken();
  const [captchaEpoch, setCaptchaEpoch] = useState(0);
  const [lastError, setLastError] = useState<string | undefined>(undefined);
  // 本地历史：仅作输入便利，服务端仍按「订单号 + 邮箱」双因子校验。
  // 用惰性初始化而非 useEffect+setState：避免额外的渲染级联。
  // 组件是客户端组件，首渲染即可读取 localStorage。
  const [history, setHistory] = useState<CachedOrder[]>(() => readCachedOrders());
  const [orderNo, setOrderNo] = useState("");
  const [email, setEmail] = useState("");

  const captchaEnabled = !!turnstile?.enabled && !!turnstile.siteKey;

  // 查询失败 → token 已消费，重挂载挑战（渲染期调整状态模式）
  if (state?.error !== lastError) {
    setLastError(state?.error);
    if (state?.error && captchaEnabled) {
      resetToken();
      setCaptchaEpoch((e) => e + 1);
    }
  }

  /** 点击历史记录：填入订单号与邮箱，随后即可查询 */
  const fillFromHistory = (o: CachedOrder) => {
    setOrderNo(o.orderNo);
    setEmail(o.email);
  };

  const order = state?.order;

  return (
    <div className="space-y-8">
      {history.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">本机最近的订单</h2>
            <button
              type="button"
              onClick={() => {
                clearCachedOrders();
                setHistory([]);
              }}
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              清除本地记录
            </button>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {history.map((o) => (
              <li key={o.orderNo}>
                <button
                  type="button"
                  onClick={() => fillFromHistory(o)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm transition-colors hover:bg-secondary"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{o.productName}</span>
                    <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                      {o.orderNo}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs">{o.total}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            点击任一条目可自动填入订单号与邮箱，用于重新支付、取消或查询。
            这些记录仅保存在本机浏览器；服务端仍会校验「订单号 + 邮箱」。
          </p>
        </section>
      ) : null}

      <form className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]" action={formAction}>
        <div className="space-y-1.5">
          <Label htmlFor="q-order">订单号</Label>
          <Input
            id="q-order"
            name="orderNo"
            value={orderNo}
            onChange={(e) => setOrderNo(e.target.value)}
            placeholder="LS20261011XXXXXXXXXX"
            className="font-mono text-sm"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="q-email">下单邮箱</Label>
          <Input
            id="q-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" className="w-full sm:w-auto" disabled={pending || (captchaEnabled && !token)}>
            {pending ? "查询中…" : "查询"}
          </Button>
        </div>
        {captchaEnabled ? (
          <div className="sm:col-span-3">
            <TurnstileWidget key={captchaEpoch} siteKey={turnstile!.siteKey} onToken={setToken} />
            {/* 必须把 token 随表单提交：lookupOrderAction 校验的是 formData 里的
                cfToken。缺少这个隐藏域时，服务端永远收到空串，
                导致「人机验证未通过」——即使验证码已在客户端通过。 */}
            <input type="hidden" name="cfToken" value={token ?? ""} />
            {!token ? (
              <p className="text-xs text-muted-foreground">查询前请先完成人机验证</p>
            ) : null}
          </div>
        ) : null}
        {state?.error ? (
          <p className="text-sm text-pastel-red-text sm:col-span-3">{state.error}</p>
        ) : null}
      </form>

      {order ? (
        <Card className="border-border bg-card">
          <CardContent className="p-8">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-serif text-xl">订单详情</h2>
              <StatusBadge status={order.status} label={order.statusLabel} />
            </div>
            {/* 操作区：未支付订单提供「重新支付」与「取消」，
                已完成订单只需查看 —— 方便买家自助处理，无需再联系客服。 */}
            {order.status === "pending" ? (
              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
                {order.paymentUrl ? (
                  <a
                    href={`/pay/pending?order_no=${encodeURIComponent(order.orderNo)}`}
                    className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-[#333333]"
                  >
                    重新支付
                  </a>
                ) : null}
                <CancelOrder orderNo={order.orderNo} />
              </div>
            ) : null}

            <dl className="mt-6 space-y-3 text-sm">
              <Row label="订单号">
                <span className="font-mono text-xs">{order.orderNo}</span>
              </Row>
              <Row label="商品">
                {order.productName} × {order.quantity}
              </Row>
              <Row label="金额">
                <span className="font-mono">{order.totalFormatted}</span>
              </Row>
              <Row label="邮箱">{order.emailMasked}</Row>
              <Row label="下单时间">
                <span className="font-mono text-xs">{order.createdAtText}</span>
              </Row>
            </dl>

            {order.deliveryContent != null ? (
              <div className="mt-6">
                <p className="mb-2 text-sm font-medium">卡密 / 交付内容</p>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary p-4 font-mono text-xs leading-relaxed select-all">
                  {order.deliveryContent}
                </pre>
              </div>
            ) : order.status === "pending" && order.paymentUrl ? (
              <div className="mt-6 rounded-lg bg-secondary p-4 text-sm leading-relaxed">
                订单尚未支付。
                <a
                  href={`/pay/pending?order_no=${encodeURIComponent(order.orderNo)}`}
                  className="mx-1 font-medium underline underline-offset-4"
                >
                  继续支付
                </a>
              </div>
            ) : (
              <div className="mt-6 rounded-lg bg-secondary p-4 text-sm leading-relaxed">
                {order.status === "paid"
                  ? "支付已确认，订单处理中；人工商品会尽快发货。"
                  : order.status === "delivering"
                    ? "正在为你发货，请稍后再来查看。"
                    : "暂无交付内容。"}
              </div>
            )}
          </CardContent>
        </Card>
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
