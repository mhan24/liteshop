"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { checkoutAction, type CheckoutSuccess } from "@/actions/shop";
import { useCart } from "./cart";
import { TurnstileWidget } from "./turnstile-widget";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import type { TurnstileClientConfig } from "@/server/settings";

export interface ChannelOption {
  key: string;
  displayName: string;
}

/** 结算页：购物车 + 邮箱 + 支付方式 → 创建订单（金额由服务端计算） */
export function CheckoutClient({
  channels,
  currency,
  human,
}: {
  channels: ChannelOption[];
  currency: string;
  human: TurnstileClientConfig;
}) {
  const { items, setQuantity, remove } = useCart();
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
      <div className="mx-auto max-w-xl space-y-5 rounded-xl border border-line bg-surface p-8">
        <div className="space-y-1">
          <h2 className="font-serif text-xl font-semibold tracking-tight">订单已创建</h2>
          <p className="text-sm text-muted">{state.message}</p>
        </div>
        <dl className="space-y-2 rounded-lg bg-surface-2 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">订单号</dt>
            <dd className="font-mono">{d.orderNo}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">应付金额</dt>
            <dd className="font-semibold">{d.totalDisplay}</dd>
          </div>
        </dl>
        <div className="rounded-lg border border-tint-yellow-fg/25 bg-tint-yellow p-4">
          <p className="text-sm font-medium text-tint-yellow-fg">查单密码 · 仅显示一次</p>
          <p className="mt-2 select-all font-mono text-2xl tracking-[0.3em] text-fg">{d.queryPassword}</p>
          <p className="mt-2 text-xs leading-5 text-tint-yellow-fg">
            凭订单号、邮箱与查单密码可随时查询订单与卡密，请立即保存；遗失后需联系客服找回。
          </p>
        </div>
        {d.paymentUrl ? (
          <a
            href={d.paymentUrl}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-accent text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover active:scale-[0.98]"
          >
            前往收银台支付
          </a>
        ) : null}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="space-y-1 rounded-xl border border-line bg-surface p-10 text-center">
        <p className="font-serif text-lg">购物车是空的</p>
        <p className="text-sm text-muted">
          先去挑选商品，再回来完成结算。{" "}
          <Link href="/" className="text-fg underline decoration-line underline-offset-4 hover:decoration-fg">
            返回商品列表
          </Link>
        </p>
      </div>
    );
  }

  const total = items.reduce((acc, i) => acc + i.priceCents * i.quantity, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <form action={formAction} className="space-y-6">
        <input type="hidden" name="items" value={JSON.stringify(items.map((i) => ({ slug: i.slug, quantity: i.quantity })))} />
        <input type="hidden" name="channelKey" value={channels[0]?.key ?? ""} />
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {items.map((item) => (
            <li key={item.slug} className="flex items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {formatMoney(item.priceCents, currency)} × {item.quantity}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={item.quantity}
                  onChange={(e) => setQuantity(item.slug, Number(e.target.value))}
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
            <Label htmlFor="co-email">联系邮箱</Label>
            <Input id="co-email" name="email" type="email" required placeholder="you@example.com" />
            <p className="text-xs text-muted">交付内容与订单信息会发送到这个邮箱。</p>
          </div>
          {channels.length > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="co-channel">支付方式</Label>
              <Select id="co-channel" name="channelKey" defaultValue={channels[0]?.key}>
                {channels.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.displayName}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="co-note">备注（可选）</Label>
            <Textarea id="co-note" name="note" maxLength={500} rows={2} placeholder="如有特殊说明请在此填写" />
          </div>
          {state && !state.ok ? (
            <p role="alert" className="rounded-lg border border-tint-red-fg/25 bg-tint-red px-3 py-2 text-sm text-tint-red-fg">
              {state.message}
            </p>
          ) : null}
          {human.enabled ? (
            <div className="space-y-1.5">
              <Label>人机验证</Label>
              <TurnstileWidget key={verifyKey} siteKey={human.siteKey} onToken={setCfToken} />
              <input type="hidden" name="cfToken" value={cfToken} />
              {human.fallback ? (
                <p className="text-xs text-muted">验证加载失败时仍可提交，系统会以其他方式防护。</p>
              ) : null}
            </div>
          ) : null}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "正在创建订单…" : "提交订单并支付"}
          </Button>
          <p className="text-center text-xs leading-5 text-muted">
            点击「提交订单并支付」即表示同意：数字商品一经交付，非质量问题不支持退款。
          </p>
        </div>
      </form>

      <aside className="lg:sticky lg:top-10 lg:self-start">
        <div className="space-y-3 rounded-xl border border-line bg-surface p-6">
          <h2 className="font-serif text-lg font-semibold tracking-tight">订单摘要</h2>
          <ul className="space-y-2 text-sm">
            {items.map((item) => (
              <li key={item.slug} className="flex justify-between gap-4">
                <span className="min-w-0 truncate text-muted">
                  {item.name} × {item.quantity}
                </span>
                <span>{formatMoney(item.priceCents * item.quantity, currency)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-sm text-muted">应付金额</span>
            <span className="font-serif text-xl font-semibold tracking-tight">{formatMoney(total, currency)}</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
