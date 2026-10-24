"use client";

import { useActionState } from "react";
import {
  savePaymentChannelsAction,
  type PaymentChannelsSaveState,
} from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Flash } from "@/components/admin/flash";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 支付渠道统一表单（设置 → 支付）：bepusdt + litepay 一次提交、一个保存按钮。
 *
 * 保存走 Server Action（POST），结果经 useActionState 在当前响应内直接渲染，
 * 不再 redirect?flash=…（旧模式经 GET 导航回传状态，URL 会带上一次性参数）。
 */
export function PaymentChannelForms({
  csrf,
  bep,
  bepEnabled,
  lp,
  lpEnabled,
}: {
  csrf: string;
  bep: Record<string, unknown>;
  bepEnabled: boolean;
  lp: Record<string, unknown>;
  lpEnabled: boolean;
}) {
  const [state, formAction, pending] = useActionState<PaymentChannelsSaveState | null, FormData>(
    savePaymentChannelsAction,
    null
  );

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="csrf" value={csrf} />

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">支付渠道 · bepusdt（收银台）</CardTitle>
          <CardDescription>
            对接 pay.9527.tr 等 BEpusdt 协议网关：下单跳转网关收银台，买家先选 Binance / OKX、
            再选 USDT / USDC，按页面精确金额发起站内转账，到账后网关回调本站自动发货。
            对接令牌在网关后台「API Token」页生成/轮换。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid max-w-xl gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="bep-api">网关地址（仅域名，不带接口路径）</Label>
            <Input
              id="bep-api"
              name="bepusdt.apiBase"
              defaultValue={String(bep["api_base"] ?? "")}
              placeholder="https://pay.9527.tr"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="bep-token">对接令牌（API Token）</Label>
            <Input
              id="bep-token"
              name="bepusdt.token"
              type="password"
              placeholder={bep["token"] ? "已设置（留空则不修改）" : "未设置"}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bep-timeout">订单超时（秒，180–3600）</Label>
            <Input
              id="bep-timeout"
              name="bepusdt.timeout"
              type="number"
              min={180}
              max={3600}
              step={1}
              defaultValue={String(bep["timeout_seconds"] ?? 600)}
            />
            <p className="text-xs text-muted-foreground">
              与网关收银台有效期保持一致（pay.9527.tr 默认 600 即 10 分钟）；越界值会被网关忽略。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bep-currencies">币种限制（可选）</Label>
            <Input
              id="bep-currencies"
              name="bepusdt.currencies"
              defaultValue={String(bep["currencies"] ?? "")}
              placeholder="USDT,USDC"
            />
            <p className="text-xs text-muted-foreground">收银台可选币种，逗号分隔；留空表示不限制。</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bep-name">前台显示名称（可选）</Label>
            <Input
              id="bep-name"
              name="bepusdt.displayName"
              defaultValue={String(bep["display_name"] ?? "")}
              placeholder="加密货币收银台"
            />
            <p className="text-xs text-muted-foreground">买家下单时看到的支付方式名称；留空用默认文案。</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bep-sort">显示优先级（0–999）</Label>
            <Input
              id="bep-sort"
              name="bepusdt.sortOrder"
              type="number"
              min={0}
              max={999}
              step={1}
              defaultValue={String(bep["sort_order"] ?? 0)}
            />
            <p className="text-xs text-muted-foreground">
              数字越小越靠前；买家不选时默认走排最前的启用渠道。
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              name="bepusdt.reselect"
              defaultChecked={bep["reselect"] !== false}
              className="size-4"
            />
            允许买家在收银台重选收款平台与币种（reselect）
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              name="bepusdt.enabled"
              defaultChecked={bepEnabled}
              className="size-4"
            />
            启用 bepusdt 渠道
          </label>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">支付渠道 · litepay（LitePay 收银台）</CardTitle>
          <CardDescription>
            对接 LitePay 网关（pay.9527.tr）的 BEpusdt 兼容接口：下单跳转 LitePay 收银台，
            买家先选 Binance / OKX、再选 USDT / USDC，按页面精确金额发起站内转账。
            令牌在 LitePay 管理台「轮换 API Token」页生成。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid max-w-xl gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="lp-api">网关地址（仅域名，不带接口路径）</Label>
            <Input
              id="lp-api"
              name="litepay.apiBase"
              defaultValue={String(lp["api_base"] ?? "")}
              placeholder="https://pay.9527.tr"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="lp-token">对接令牌（API Token）</Label>
            <Input
              id="lp-token"
              name="litepay.token"
              type="password"
              placeholder={lp["token"] ? "已设置（留空则不修改）" : "未设置"}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lp-timeout">订单超时（秒，180–3600）</Label>
            <Input
              id="lp-timeout"
              name="litepay.timeout"
              type="number"
              min={180}
              max={3600}
              step={1}
              defaultValue={String(lp["timeout_seconds"] ?? 600)}
            />
            <p className="text-xs text-muted-foreground">
              与网关收银台有效期保持一致（默认 600 即 10 分钟）；越界值会被网关忽略。
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lp-currencies">币种限制（可选）</Label>
            <Input
              id="lp-currencies"
              name="litepay.currencies"
              defaultValue={String(lp["currencies"] ?? "")}
              placeholder="USDT,USDC"
            />
            <p className="text-xs text-muted-foreground">收银台可选币种，逗号分隔；留空表示不限制。</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lp-name">前台显示名称（可选）</Label>
            <Input
              id="lp-name"
              name="litepay.displayName"
              defaultValue={String(lp["display_name"] ?? "")}
              placeholder="LitePay 收银台（USDT / USDC）"
            />
            <p className="text-xs text-muted-foreground">买家下单时看到的支付方式名称；留空用默认文案。</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lp-sort">显示优先级（0–999）</Label>
            <Input
              id="lp-sort"
              name="litepay.sortOrder"
              type="number"
              min={0}
              max={999}
              step={1}
              defaultValue={String(lp["sort_order"] ?? 0)}
            />
            <p className="text-xs text-muted-foreground">
              数字越小越靠前；买家不选时默认走排最前的启用渠道。
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              name="litepay.reselect"
              defaultChecked={lp["reselect"] !== false}
              className="size-4"
            />
            允许买家在收银台重选收款平台与币种（reselect）
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              name="litepay.enabled"
              defaultChecked={lpEnabled}
              className="size-4"
            />
            启用 litepay 渠道
          </label>
        </CardContent>
      </Card>

      {state ? <Flash ok={state.ok ? state.message : undefined} err={state.ok ? undefined : state.message} /> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "正在保存…" : "保存支付渠道设置"}
        </Button>
        <p className="text-xs text-muted-foreground">两个渠道的配置统一保存；令牌留空表示不修改。</p>
      </div>
    </form>
  );
}
