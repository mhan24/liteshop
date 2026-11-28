"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { checkoutAction, type CheckoutSuccess } from "@/actions/shop";
import { useCart } from "./cart";
import { TurnstileWidget } from "./turnstile-widget";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
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
  const { items, setQuantity, remove, removePurchased } = useCart();
  const [state, formAction, pending] = useActionState(checkoutAction, null);

  const receipt = state?.ok ? state.data : undefined;
  const lastRemoved = useRef<string | null>(null);
  useEffect(() => {
    if (receipt?.purchasedItems.length && lastRemoved.current !== receipt.orderNo) {
      lastRemoved.current = receipt.orderNo;
      removePurchased(receipt.purchasedItems);
    }
  }, [receipt, removePurchased]);
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
      <div className="mx-auto max-w-xl space-y-6 rounded-md border border-line bg-surface p-8">
        <div className="space-y-2">
          <p className="eyebrow">订单已创建</p>
          <h2 className="text-2xl font-semibold tracking-[-0.02em]">{state.message}</h2>
        </div>

        <dl className="divide-y divide-line rounded-sm border border-line text-sm">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-muted">订单号</dt>
            <dd className="data select-all">{d.orderNo}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <dt className="text-muted">应付金额</dt>
            <dd className="data text-lg font-semibold">{d.totalDisplay}</dd>
          </div>
        </dl>

        <div className="space-y-3 rounded-sm border border-tint-yellow-fg/25 bg-tint-yellow p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-tint-yellow-fg">
            <span aria-hidden className="live-dot" />
            查单密码 · 仅显示一次
          </p>
          <p className="data select-all rounded-sm border border-line bg-sunken px-4 py-3 text-center text-2xl tracking-[0.3em] text-fg">
            {d.queryPassword}
          </p>
          <p className="text-xs leading-5 text-tint-yellow-fg">
            请连同订单号一并保存。后续查询订单与查看卡密均需使用，遗失后仅能联系客服核对。
          </p>
          <CopyButton
            text={`订单号：${d.orderNo}\n查单密码：${d.queryPassword}`}
            label="复制订单号和查单密码"
            className="w-full"
          />
        </div>

        {d.paymentUrl ? (
          <a
            href={d.paymentUrl}
            className="inline-flex h-10 w-full items-center justify-center rounded-sm bg-accent text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover active:scale-[0.98]"
          >
            前往收银台付款
          </a>
        ) : (
          <p className="rounded-sm border border-tint-yellow-fg/25 bg-tint-yellow px-4 py-3 text-xs leading-5 text-tint-yellow-fg">
            {d.reconciling ? "订单正在核实，请勿重复付款。" : "当前无需继续付款。"}{" "}
            <Link href={`/pay/${d.orderNo}`} className="underline">查看订单状态</Link>
          </p>
        )}

        <p className="text-xs leading-5 text-faint">
          {d.purchasedItems.length ? "本单商品已从购物车扣除。" : "本单商品已保留在购物车。"}可在「订单查询」查看订单状态。
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-2 rounded-md border border-line bg-surface px-6 py-16 text-center">
        <p className="text-lg">购物车为空</p>
        <p className="text-sm text-muted">
          请先挑选商品，再前往结算，
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

        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
          {items.map((item) => (
            <li key={item.slug} className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="mt-1 font-mono text-xs text-muted">
                  <span className="data">{formatMoney(item.priceCents)}</span> × {item.quantity}
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

        <div className="space-y-5 rounded-md border border-line bg-surface p-6">
          <div className="space-y-1.5">
            <Label htmlFor="co-email">下单邮箱</Label>
            <Input id="co-email" name="email" type="email" required placeholder="you@example.com" />
            <p className="text-xs leading-5 text-muted">查询订单和查看卡密时需要使用这个邮箱。</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="co-note">备注（可选）</Label>
            <Textarea
              id="co-note"
              name="note"
              maxLength={500}
              rows={2}
              placeholder="如有需要补充的信息可填在此处"
            />
          </div>

          {state && !state.ok ? (
            <p
              role="alert"
              className="rounded-sm border border-tint-red-fg/25 bg-tint-red px-3 py-2 text-sm text-tint-red-fg"
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
                <p className="text-xs text-muted">如验证组件加载失败，仍可直接提交（下单频率限制保持生效）。</p>
              ) : null}
            </div>
          ) : null}

          {!gatewayReady ? (
            <p className="rounded-sm border border-tint-red-fg/25 bg-tint-red px-3 py-2 text-sm text-tint-red-fg">
              收款通道尚未就绪，暂时无法下单，请联系客服或稍后再试。
            </p>
          ) : null}

          <Button type="submit" disabled={pending || !gatewayReady} className="w-full">
            {pending ? "正在创建订单…" : `提交订单 · ${formatMoney(total)}`}
          </Button>
          <p className="text-center text-xs leading-5 text-muted">
            提交后会生成订单号与查单密码，保存后前往 LitePay 收银台付款（支持 USDT / USDC）。数字商品一经发放不支持退款。
          </p>
        </div>
      </form>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="space-y-4 rounded-md border border-line bg-surface p-6">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">订单摘要</h2>
          <ul className="space-y-2 text-sm">
            {items.map((item) => (
              <li key={item.slug} className="flex justify-between gap-4">
                <span className="min-w-0 truncate text-muted">
                  {item.name} × {item.quantity}
                </span>
                <span><span className="data">{formatMoney(item.priceCents * item.quantity)}</span></span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between border-t border-line pt-4">
            <span className="text-sm text-muted">应付金额</span>
            <span className="text-xl font-semibold tracking-[-0.01em]"><span className="data">{formatMoney(total)}</span></span>
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
