"use client";

import { useState, useActionState } from "react";
import { verifyOrderAccessAction, type VerifyAccessState } from "@/actions/shop";
import { TurnstileWidget, useTurnstileToken } from "@/components/shop/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 待支付页就地访问验证：换浏览器/丢 cookie 打开待支付链接时，
 * 凭「下单邮箱」即可解锁本页（无需绕道查单页）。
 * 双因子（订单号已在 URL 中）与服务端限流不变。
 */
export function OrderAccessGate({
  orderNo,
  turnstile,
}: {
  orderNo: string;
  turnstile?: { enabled: boolean; siteKey: string; fallback: boolean };
}) {
  const [state, formAction, pending] = useActionState<VerifyAccessState | null, FormData>(
    verifyOrderAccessAction,
    null
  );
  const { token, setToken, resetToken } = useTurnstileToken();
  const [captchaEpoch, setCaptchaEpoch] = useState(0);
  const [lastError, setLastError] = useState<string | undefined>(undefined);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);

  const captchaEnabled = !!turnstile?.enabled && !!turnstile.siteKey;
  const captchaFallback = captchaEnabled && !!turnstile?.fallback;

  // 验证失败 → token 已消费，重挂载挑战（渲染期调整状态模式）
  if (state?.error !== lastError) {
    setLastError(state?.error);
    if (state?.error && captchaEnabled) {
      resetToken();
      setCaptchaEpoch((e) => e + 1);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-8">
      <h1 className="font-serif text-2xl tracking-tight">验证订单信息</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        为保护订单信息，请输入<b className="mx-1 font-medium text-foreground">下单时使用的邮箱</b>
        验证后查看付款方式与订单状态。
      </p>
      <form action={formAction} className="mt-6 space-y-4">
        <input type="hidden" name="orderNo" value={orderNo} />
        {captchaEnabled ? <input type="hidden" name="cfToken" value={token ?? ""} /> : null}
        {captchaFallback && captchaUnavailable ? (
          <input type="hidden" name="cfFallback" value="1" />
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="gate-email">下单邮箱</Label>
          <Input
            id="gate-email"
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        {captchaEnabled ? (
          <TurnstileWidget
            key={captchaEpoch}
            siteKey={turnstile!.siteKey}
            onToken={setToken}
            onUnavailable={() => setCaptchaUnavailable(true)}
          />
        ) : null}
        {state?.error ? <p className="text-sm text-pastel-red-text">{state.error}</p> : null}
        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={pending || (captchaEnabled && !token && !(captchaFallback && captchaUnavailable))}
        >
          {pending ? "验证中…" : "验证并查看付款方式"}
        </Button>
      </form>
    </div>
  );
}
