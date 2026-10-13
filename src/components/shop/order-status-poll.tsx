"use client";

import { useEffect, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TurnstileWidget, useTurnstileToken } from "@/components/shop/turnstile-widget";
import {
  cancelOrderAction,
  repurchaseOrderAction,
  type CancelOrderState,
  type RepurchaseState,
} from "@/actions/shop";
import { openPaymentWindow, toAbsoluteUrl } from "@/lib/open-payment-window";
import { SupportLink } from "@/components/shop/support-link";

export interface OrderStatusPayload {
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
  /** 商品标识：用于过期后「重新购买」跳回商品页 */
  productSlug?: string | null;
  /** 是否允许重新购买（服务端统一计算：状态 + 未收款 + 无待处理异常到账） */
  canRepurchase?: boolean;
  /** 不能重购的原因，用于前台提示 */
  repurchaseBlockedReason?: string | null;
  /** 交易所转账指引；非交易所渠道为 null */
  transferInstructions?: {
    exchange: string;
    accountId: string;
    amount: string;
    asset: string;
    expiresAtText: string | null;
  } | null;
}

/** 客服入口：地址为空时不渲染由 SupportLink 内部处理 */
export interface SupportConfig {
  url: string | null;
  label: string;
}

/** 回跳页状态轮询：2s 间隔，completed/expired/closed 停止 */
export function OrderStatusPoll({
  orderNo,
  initial,
  payCTA = false,
  turnstile,
  support,
  accessGate,
}: {
  orderNo: string;
  initial: OrderStatusPayload | null;
  /** 待支付页模式：pending 时显示前往收银台按钮 */
  payCTA?: boolean;
  /** 后台启用 Turnstile 时由服务端下发（重新购买表单需要渲染验证码） */
  turnstile?: { enabled: boolean; siteKey: string };
  /** 无访问凭据时就地验证入口（待支付页传入） */
  accessGate?: React.ReactNode;
  /** 客服入口（由服务端读取设置后下发） */
  support?: SupportConfig;
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
            if (!["pending", "paid", "delivering", "reconciling"].includes(json.order.status)) return; // 终态停轮询
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
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <p className="font-serif text-xl">请验证订单信息</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {accessGate
              ? "输入下单邮箱完成验证，即可在本页继续。"
              : "请前往订单查询，凭订单号和邮箱验证后继续。"}
          </p>
          {accessGate ? null : (
            <a href="/orders" className="mt-4 inline-block underline underline-offset-4">前往订单查询</a>
          )}
        </div>
        {accessGate}
      </div>
    );
  }
  if (!order) return null;

  // reconciling 仍在等待人工/回调确认，不应视为终态停止轮询
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
          <>
            订单已超时未支付，占用的库存已释放。如已付款请
            <SupportLink url={support?.url} label={support?.label ?? "联系客服"} />
            核实。
          </>
        ) : order.status === "reconciling" ? (
          <>
            支付状态待核实：我们未能确认本次支付是否已在网关创建。
            <b className="mx-1">请勿重复付款</b>，
            <SupportLink url={support?.url} label={support?.label ?? "联系客服"} />
            核对后会尽快处理；也可稍后回到本页查看。
          </>
        ) : (
          <>
            订单已关闭。如已付款请
            <SupportLink url={support?.url} label={support?.label ?? "联系客服"} />
            核实。
          </>
        )}
      </div>

      {["expired", "closed", "reconciling"].includes(order.status) ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          支付遇到问题？
          <SupportLink url={support?.url} label={support?.label ?? "联系客服"} />
        </p>
      ) : null}

      {/* 交易所转账：没有收银台地址，必须给出账户与**精确金额**，
          否则买家无从付款（金额必须分毫不差，系统靠它识别到账）。 */}
      {order.status === "pending" && payCTA && order.transferInstructions ? (
        <div className="mt-5 space-y-4 rounded-lg border border-border bg-secondary p-4 text-sm">
          <div className="leading-relaxed">
            请在 <b>{order.transferInstructions.exchange}</b>{" "}
            通过「内部转账」向下方账户付款，转账金额必须与页面显示**完全一致**
            （多付或少付都无法自动识别）。
          </div>
          <dl className="space-y-2">
            <TransferRow label="收款账户" value={order.transferInstructions.accountId} mono />
            <TransferRow
              label="转账金额"
              value={`${order.transferInstructions.amount} ${order.transferInstructions.asset}`}
              mono
            />
            {order.transferInstructions.expiresAtText ? (
              <TransferRow label="请在此时间前完成" value={order.transferInstructions.expiresAtText} />
            ) : null}
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">
            到账后系统会自动识别并发货，通常 1 分钟内完成；若超时仍未到账，
            请勿重复下单，请联系客服并提供订单号与转账截图。
          </p>
        </div>
      ) : order.status === "pending" && payCTA && order.paymentUrl ? (
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

      {/* 重购资格一律以服务端计算的 canRepurchase 为准，不自行用 status 推断。
          否则「已付款后被关闭」或「有待处理异常到账」的订单也会显示按钮，
          买家填完邮箱提交才被拒绝（后端规则与前端展示漂移）。 */}
      {order.canRepurchase === true && payCTA ? (
        <RepurchaseOrder
          orderNo={order.orderNo}
          productSlug={order.productSlug ?? null}
          turnstile={turnstile}
        />
      ) : null}

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

/** 转账指引中的一行（值可复制，故给 mono 字体） */
function TransferRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`text-right ${mono ? "select-all break-all font-mono text-xs" : ""}`}>{value}</dd>
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
export function CancelOrder({ orderNo }: { orderNo: string }) {
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

/**
 * 过期/关闭订单「重新购买」。
 *
 * 过期订单不恢复原单（库存已释放，且旧交易回调可能仍在途），
 * 而是创建一笔新订单 —— 语义与库存、支付路径都更清晰。
 */
function RepurchaseOrder({
  orderNo,
  productSlug,
  turnstile,
}: {
  orderNo: string;
  productSlug: string | null;
  turnstile?: { enabled: boolean; siteKey: string };
}) {
  const [state, formAction, pending] = useActionState<RepurchaseState | null, FormData>(
    repurchaseOrderAction,
    null
  );
  const [asking, setAsking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const router = useRouter();
  // 重新购买同样会创建订单：必须与商品页一致地过 Turnstile，
  // 否则开启验证码后该入口会被服务端守卫拒绝（且此前根本没渲染验证码）。
  const { token, setToken, resetToken } = useTurnstileToken();
  const [captchaEpoch, setCaptchaEpoch] = useState(0);
  const [lastError, setLastError] = useState<string | undefined>(undefined);
  const captchaEnabled = !!turnstile?.enabled && !!turnstile.siteKey;

  // 提交失败时 Turnstile token 已被消费，需重挂挑战
  if (state?.error !== lastError) {
    setLastError(state?.error);
    if (state?.error && captchaEnabled) {
      resetToken();
      setCaptchaEpoch((e) => e + 1);
    }
  }

  // 与普通下单保持一致：先跳到新的「待支付页」，由买家点击按钮再打开收银台。
  // 好处：① 不会触发浏览器弹窗拦截；② 买家能看到并保存新的订单号。
  useEffect(() => {
    if (state?.ok && state.orderNo) {
      router.push(`/pay/pending?order_no=${encodeURIComponent(state.orderNo)}`);
    }
  }, [state, router]);

  if (state?.ok) {
    return (
      <div className="mt-4 rounded-lg border border-border p-4 text-sm">
        <p className="text-muted-foreground">
          {state.message}（新订单号 {state.orderNo}），正在跳转…
        </p>
      </div>
    );
  }

  // 点击时**重新获取一次资格**：终态订单会停止轮询，若期间迟到了成功回调
  // （登记为待处理异常到账），本地缓存的 canRepurchase 可能已过期。
  // 服务端提交时仍会兜底校验，这里只是让提示更及时、更准确。
  const onRepurchaseClick = async () => {
    setChecking(true);
    setBlocked(null);
    try {
      const res = await fetch(`/api/orders/status?order_no=${encodeURIComponent(orderNo)}`);
      const json = (await res.json()) as { ok: boolean; order?: OrderStatusPayload };
      if (json.ok && json.order && json.order.canRepurchase !== true) {
        setBlocked(json.order.repurchaseBlockedReason ?? "该订单当前无法重新购买");
        setChecking(false);
        return;
      }
    } catch {
      // 网络失败时继续走原流程，由服务端最终把关
    }
    setChecking(false);
    setAsking(true);
  };

  if (!asking) {
    return (
      <>
        {blocked ? <p className="mt-3 text-sm text-pastel-red-text">{blocked}</p> : null}
        <button
          type="button"
          onClick={onRepurchaseClick}
          disabled={checking}
          className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-[#333333] active:scale-[0.98] disabled:opacity-60"
        >
          {checking ? "正在确认订单状态…" : "重新购买"}
        </button>
      </>
    );
  }

  return (
    <form action={formAction} className="mt-4 space-y-3 rounded-lg border border-border p-4">
      <input type="hidden" name="orderNo" value={orderNo} />
      <p className="text-sm text-muted-foreground">
        将为你创建一笔**新订单**（原订单已失效、库存已释放）。请填写下单邮箱以确认。
      </p>
      <Input name="email" type="email" required placeholder="下单时填写的邮箱" autoComplete="email" />
      {captchaEnabled ? <input type="hidden" name="cfToken" value={token ?? ""} /> : null}
      {captchaEnabled ? (
        <div className="space-y-1">
          <TurnstileWidget key={captchaEpoch} siteKey={turnstile!.siteKey} onToken={setToken} />
          {!token ? <p className="text-xs text-muted-foreground">提交前请先完成人机验证</p> : null}
        </div>
      ) : null}
      {state?.error ? (
        <p className="text-sm text-pastel-red-text">
          {state.error}
          {productSlug ? (
            <>
              {" "}
              <a href={`/products/${productSlug}`} className="font-medium underline underline-offset-4">
                返回商品页
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={pending || (captchaEnabled && !token)}>
          {pending ? "正在创建…" : "确认并前往支付"}
        </Button>
        <Button type="button" variant="ghost" className="flex-1" onClick={() => setAsking(false)} disabled={pending}>
          返回
        </Button>
      </div>
    </form>
  );
}
