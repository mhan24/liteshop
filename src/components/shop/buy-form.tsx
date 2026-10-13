"use client";

import { useEffect, useState, useActionState } from "react";
import { createOrderAction, type CreateOrderState } from "@/actions/shop";
import { TurnstileWidget, useTurnstileToken } from "@/components/shop/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** 前台可选的支付方式（与服务端 CheckoutMethod 对应） */
export interface CheckoutOption {
  value: "bepusdt" | "exchange";
  label: string;
  hint: string;
}

export function BuyForm({
  slug,
  maxQuantity,
  deliveryType,
  turnstile,
  methods,
  buttonText = "立即购买",
  notice = "",
}: {
  slug: string;
  maxQuantity: number;
  deliveryType: string;
  /** 后台启用了 Turnstile 时由服务端传入 */
  turnstile?: { enabled: boolean; siteKey: string };
  /** 服务端计算的可选支付方式；不传则不显示选择器 */
  methods?: CheckoutOption[];
  buttonText?: string;
  notice?: string;
}) {
  const [state, formAction, pending] = useActionState<CreateOrderState | null, FormData>(
    createOrderAction,
    null
  );
  const [quantity, setQuantity] = useState("1");
  const { token, setToken, resetToken } = useTurnstileToken();
  const [captchaEpoch, setCaptchaEpoch] = useState(0);
  const [lastError, setLastError] = useState<string | undefined>(undefined);

  const captchaEnabled = !!turnstile?.enabled && !!turnstile.siteKey;

  // 下单成功 → 先跳待支付页，由待支付页按钮在新窗口打开收银台
  useEffect(() => {
    if (state?.paymentUrl) {
      window.location.href = state.paymentUrl;
    }
  }, [state]);

  // 提交失败 → Turnstile token 已被消费，重挂载挑战（渲染期调整状态模式）
  if (state?.error !== lastError) {
    setLastError(state?.error);
    if (state?.error && captchaEnabled) {
      resetToken();
      setCaptchaEpoch((e) => e + 1);
    }
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      {captchaEnabled ? <input type="hidden" name="cfToken" value={token ?? ""} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="buy-email">联系邮箱</Label>
          <Input
            id="buy-email"
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
          />
          <p className="text-xs text-muted-foreground">用于订单查询与接收交付内容</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="buy-quantity">数量</Label>
          <input type="hidden" name="quantity" value={quantity} />
          <Select value={quantity} onValueChange={setQuantity}>
            <SelectTrigger id="buy-quantity" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: Math.max(1, Math.min(10, maxQuantity || 1)) }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {deliveryType === "manual" ? (
        <div className="space-y-1.5">
          <Label htmlFor="buy-note">备注（选填）</Label>
          <Textarea id="buy-note" name="note" rows={3} placeholder="补充你的需求，便于人工处理" />
        </div>
      ) : null}

      {methods && methods.length > 1 ? (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">支付方式</legend>
          <div className="space-y-2 pt-1">
            {methods.map((m) => (
              <label
                key={m.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-secondary has-[:checked]:border-primary"
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={m.value}
                  defaultChecked={m.value === methods[0].value}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">{m.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : methods && methods.length === 1 ? (
        <input type="hidden" name="paymentMethod" value={methods[0].value} />
      ) : null}

      {captchaEnabled ? (
        <div className="space-y-1">
          <TurnstileWidget key={captchaEpoch} siteKey={turnstile!.siteKey} onToken={setToken} />
          {captchaEnabled && !token ? (
            <p className="text-xs text-muted-foreground">提交前请先完成人机验证</p>
          ) : null}
        </div>
      ) : null}

      {state?.error ? <p className="text-sm text-pastel-red-text">{state.error}</p> : null}

      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={pending || state?.paymentUrl != null || (captchaEnabled && !token)}
      >
        {pending ? "正在创建订单…" : state?.paymentUrl ? "正在跳转收银台…" : buttonText}
      </Button>

      <p className="text-center text-xs text-muted-foreground whitespace-pre-line">{notice}</p>
    </form>
  );
}
