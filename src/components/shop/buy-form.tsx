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

export function BuyForm({
  slug,
  maxQuantity,
  deliveryType,
  turnstile,
  buttonText = "立即购买",
  notice = "",
}: {
  slug: string;
  maxQuantity: number;
  deliveryType: string;
  /** 后台启用了 Turnstile 时由服务端传入 */
  turnstile?: { enabled: boolean; siteKey: string };
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
