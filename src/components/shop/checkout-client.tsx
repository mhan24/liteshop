"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { checkoutAction, type CheckoutSuccess } from "@/actions/shop";
import { useCart } from "./cart";
import { TurnstileWidget } from "./turnstile-widget";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import type { TurnstileClientConfig } from "@/server/settings";

/**
 * 结算页：购物车明细 + 邮箱 + 人机验证 → 创建订单。
 * 金额由服务端按商品表重算；支付走 LitePay 收银台（USD，USDT/USDC）。
 */
export function CheckoutClient({
  human,
  gatewayReady,
}: {
  human: TurnstileClientConfig;
  gatewayReady: boolean;
}) {
  const { items, setQuantity, remove, clear } = useCart();
  const [state, formAction, pending] = useActionState(checkoutAction, null);
  const [cfToken, setCfToken] = useState("");
  const [verifyKey, setVerifyKey] = useState(0);

  // 提交失败后 token 已被 siteverify 消费：清空并重挂 widget 让买家重新验证
  // （渲染期调整模式：不在 effect 里同步 setState）
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state && !state.ok) {
      setCfToken("");
      setVerifyKey((k) => k + 1);
    }
  }

  if (state?.ok && state.data) {
    const d: CheckoutSuccess = state.data;
    return (
      <div className="mx-auto max-w-xl space-y-6 rounded-xl border border-line bg-surface p-8">
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted">订单已创建</p>
          <h2 className="font-serif text-2xl font-semibold tracking-[-0.02em]">{state.message}</h2>
        </div>

        <dl className="divide-y divide-line rounded-lg border border-line text-sm">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-muted">订单号</dt>
            <dd className="font-mono">{d.orderNo}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-muted">应付金额</dt>
            <dd className="font-serif text-lg font-semibold">{d.totalDisplay}</dd>
          </div>
        </dl>

        <div className="rounded-lg border border-tint-yellow-fg/25 bg-tint-yellow p-4">
          <p className="text-sm font-medium text-tint-yellow-fg">查单密码 · 只显示这一次</p>
          <p className="mt-2 select-all font-mono text-2xl tracking-[0.3em] text-fg">{d.queryPassword}</p>
          <p className="mt-2 text-xs leading-5 text-tint-yellow-fg">
            和订单号一起保存。之后查询订单、找回卡密都要用到它，遗失只能联系客服核对。
          </p>
        </div>

        {d.paymentUrl ? (
          <a
            href={d.paymentUrl}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover active:scale-[0.98]"
          >
            打开收银台付款
          </a>
        ) : (
          <p className="rounded-lg border border-tint-yellow-fg/25 bg-tint-yellow px-4 py-3 text-xs leading-5 text-tint-yellow-fg">
            收银台响应超时，订单已保留待核实。请先不要重复下单，稍后到订单查询页确认状态。
          </p>
        )}

        <button
          type="button"
          onClick={clear}
          className="text-xs text-muted underline decoration-line underline-offset-4 hover:text-fg"
        >
          清空购物车
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-2 rounded-xl border border-line bg-surface px-6 py-16 text-center">
        <p className="font-serif text-lg">购物车是空的</p>
        <p className="text-sm text-muted">
          先挑商品再结算，
          <Link href="/" className="text-fg underline decoration-line underline-offset-4 hover:decoration-fg">
            返回商品列表
          </Link>
          。
        </p>
      </div>
    );
  }

  const total = items.reduce((acc, i) => acc + i.priceCents * i.quantity, 0);

  return (
    <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
      <form action={formAction} className="space-y-6">
        <input
          type="hidden"
          name="items"
          value={JSON.stringify(items.map((i) => ({ slug: i.slug, quantity: i.quantity })))}
        />

        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {items.map((item) => (
            <li key={item.slug} className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="mt-1 font-mono text-xs text-muted">
                  {formatMoney(item.priceCents)} × {item.quantity}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={item.quantity}
                  onChange={(e) => setQuantity(item.slug, Number(e.target.value) || 1)}
                  aria-label={`${item.name} 数量`}
                  className="w-20"
                />
                <Button type="button" variant="ghost" onClick={() => remove(item.slug)}>
                  移除
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <div className="space-y-5 rounded-xl border border-line bg-surface p-6">
          <div className="space-y-1.5">
            <Label htmlFor="co-email">下单邮箱</Label>
            <Input id="co-email" name="email" type="email" required placeholder="you@example.com" />
            <p className="text-xs leading-5 text-muted">卡密会同时发到这个邮箱，请填写常用地址。</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="co-note">备注（可选）</Label>
            <Textarea
              id="co-note"
              name="note"
              maxLength={500}
              rows={2}
              placeholder="需要补充的说明写在这里"
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
                <p className="text-xs text-muted">验证组件加载失败时仍可提交，下单频率限制仍然生效。</p>
              ) : null}
            </div>
          ) : null}

          {!gatewayReady ? (
            <p className="rounded-lg border border-tint-red-fg/25 bg-tint-red px-3 py-2 text-sm text-tint-red-fg">
              支付网关尚未配置，暂时无法下单。请联系客服或稍后再试。
            </p>
          ) : null}

          <Button type="submit" disabled={pending || !gatewayReady} className="w-full">
            {pending ? "正在创建订单…" : `提交订单 · ${formatMoney(total)}`}
          </Button>
          <p className="text-center text-xs leading-5 text-muted">
            提交后跳转 LitePay 收银台，可用 USDT / USDC 付款。数字商品一经发放不支持退款。
          </p>
        </div>
      </form>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="space-y-4 rounded-xl border border-line bg-surface p-6">
          <h2 className="font-serif text-lg font-semibold tracking-[-0.01em]">订单摘要</h2>
          <ul className="space-y-2 text-sm">
            {items.map((item) => (
              <li key={item.slug} className="flex justify-between gap-4">
                <span className="min-w-0 truncate text-muted">
                  {item.name} × {item.quantity}
                </span>
                <span>{formatMoney(item.priceCents * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between border-t border-line pt-4">
            <span className="text-sm text-muted">应付金额</span>
            <span className="font-serif text-xl font-semibold tracking-[-0.01em]">{formatMoney(total)}</span>
          </div>
          <dl className="space-y-2 border-t border-line pt-4 text-xs text-muted">
            <div className="flex justify-between gap-4">
              <dt>计价币种</dt>
              <dd className="font-mono">USD</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>收款方式</dt>
              <dd>LitePay 收银台</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>发货方式</dt>
              <dd>付款后自动发卡</dd>
            </div>
          </dl>
        </div>
      </aside>
    </div>
  );
}
