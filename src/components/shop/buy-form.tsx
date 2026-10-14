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
import { rememberOrder } from "@/lib/order-cache";

/** 前台可选的支付方式（与服务端 CheckoutMethod 对应） */
export interface CheckoutOption {
  value: "bepusdt" | "litepay";
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
  productName,
  total,
}: {
  slug: string;
  maxQuantity: number;
  deliveryType: string;
  /** 后台启用了 Turnstile 时由服务端传入 */
  turnstile?: { enabled: boolean; siteKey: string; fallback: boolean };
  /** 服务端计算的可选支付方式；不传则不显示选择器 */
  methods?: CheckoutOption[];
  /** 缓存展示用：商品名与格式化金额（由服务端传入） */
  productName: string;
  total: string;
  buttonText?: string;
  notice?: string;
}) {
  const [state, formAction, pending] = useActionState<CreateOrderState | null, FormData>(
    createOrderAction,
    null
  );
  const [quantity, setQuantity] = useState("1");
  const [email, setEmail] = useState("");
  const { token, setToken, resetToken } = useTurnstileToken();
  const [captchaEpoch, setCaptchaEpoch] = useState(0);
  const [lastError, setLastError] = useState<string | undefined>(undefined);
  /** 验证不可用（加载失败/超时）：开启降级时允许无 token 提交 */
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);

  const captchaEnabled = !!turnstile?.enabled && !!turnstile.siteKey;
  const captchaFallback = captchaEnabled && !!turnstile?.fallback;

  // 下单成功 → 先跳待支付页，由待支付页按钮在新窗口打开收银台。
  // 同时写入本地缓存：买家之后可在查单页一键"重新支付 / 取消 / 查询"。
  useEffect(() => {
    if (state?.paymentUrl && state.orderNo) {
      // 只存下单所需的最小信息；不含支付地址与交付内容
      rememberOrder({
        orderNo: state.orderNo,
        email,
        productName,
        total,
        createdAt: new Date().toISOString(),
      });
      window.location.href = state.paymentUrl;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      {captchaFallback && captchaUnavailable ? (
        <input type="hidden" name="cfFallback" value="1" />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="buy-email">联系邮箱</Label>
          <Input
            id="buy-email"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
          <TurnstileWidget
            key={captchaEpoch}
            siteKey={turnstile!.siteKey}
            onToken={setToken}
            onUnavailable={() => setCaptchaUnavailable(true)}
          />
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
        disabled={
          pending ||
          state?.paymentUrl != null ||
          (captchaEnabled && !token && !(captchaFallback && captchaUnavailable))
        }
      >
        {pending
          ? "正在创建订单…"
          : state?.paymentUrl
            ? "正在跳转收银台…"
            : captchaEnabled && !token && !(captchaFallback && captchaUnavailable)
              ? "完成人机验证后可购买"
              : buttonText}
      </Button>

      <p className="text-center text-xs text-muted-foreground whitespace-pre-line">{notice}</p>
    </form>
  );
}
