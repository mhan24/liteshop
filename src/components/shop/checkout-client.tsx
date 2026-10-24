"use client";

import { useActionState } from "react";
import { checkoutAction, type CheckoutSuccess } from "@/actions/shop";
import { useCart } from "./cart";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";

export interface ChannelOption {
  key: string;
  displayName: string;
}

/** 结算页：购物车 + 邮箱 + 支付方式 → 创建订单（金额由服务端计算） */
export function CheckoutClient({
  channels,
  currency,
}: {
  channels: ChannelOption[];
  currency: string;
}) {
  const { items, setQuantity, remove } = useCart();
  const [state, formAction, pending] = useActionState(checkoutAction, null);

  if (state?.ok && state.data) {
    const d: CheckoutSuccess = state.data;
    return (
      <div className="space-y-4 rounded-xl border border-line bg-surface p-6">
        <h2 className="font-serif text-lg font-semibold">订单已创建</h2>
        <p className="text-sm text-muted">{state.message}</p>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">订单号</dt>
            <dd className="font-mono">{d.orderNo}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">金额</dt>
            <dd>{d.totalDisplay}</dd>
          </div>
        </dl>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">查单密码（仅显示一次，请立即保存）</p>
          <p className="mt-1 select-all font-mono text-lg tracking-widest">{d.queryPassword}</p>
          <p className="mt-1 text-xs text-amber-800">
            凭「订单号 + 邮箱 + 查单密码」查询订单与卡密；遗失需联系客服。
          </p>
        </div>
        {d.paymentUrl ? (
          <a
            href={d.paymentUrl}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            前往收银台支付
          </a>
        ) : null}
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted">购物车是空的，先去挑选商品吧。</p>;
  }

  const total = items.reduce((acc, i) => acc + i.priceCents * i.quantity, 0);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="items" value={JSON.stringify(items.map((i) => ({ slug: i.slug, quantity: i.quantity })))} />
      <input type="hidden" name="channelKey" value={channels[0]?.key ?? ""} />
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {items.map((item) => (
          <li key={item.slug} className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.name}</p>
              <p className="text-xs text-muted">{formatMoney(item.priceCents, currency)} × {item.quantity}</p>
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

      <div className="space-y-4 rounded-xl border border-line bg-surface p-6">
        <div className="space-y-1.5">
          <Label htmlFor="co-email">联系邮箱</Label>
          <Input id="co-email" name="email" type="email" required placeholder="you@example.com" />
          <p className="text-xs text-muted">用于接收交付内容与订单查询</p>
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
          <Textarea id="co-note" name="note" maxLength={500} rows={2} />
        </div>
        <div className="flex items-center justify-between border-t border-line pt-4">
          <span className="text-sm text-muted">应付金额</span>
          <span className="font-serif text-xl font-semibold">{formatMoney(total, currency)}</span>
        </div>
        {state && !state.ok ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
            {state.message}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "正在创建订单…" : "提交订单并支付"}
        </Button>
        <p className="text-center text-xs text-muted">
          点击购买即同意：数字商品一经交付，非质量问题不支持退款
        </p>
      </div>
    </form>
  );
}
