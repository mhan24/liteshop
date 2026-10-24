"use client";

import { useActionState } from "react";
import { savePaymentChannelsAction, type ChannelSaveState } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Flash } from "@/components/admin/flash-view";

export interface ChannelFormRow {
  key: string;
  displayName: string;
  apiBase: string;
  hasToken: boolean;
  currencies: string;
  timeoutSeconds: number;
  reselect: boolean;
  enabled: boolean;
  sortOrder: number;
}

/**
 * 支付渠道统一表单：所有渠道一个表单、一个保存按钮；
 * 结果经 useActionState 在当前 POST 响应内渲染（无 GET 重定向）。
 */
export function PaymentChannelsForm({ channels }: { channels: ChannelFormRow[] }) {
  const [state, formAction, pending] = useActionState<ChannelSaveState | null, FormData>(
    savePaymentChannelsAction,
    null
  );

  return (
    <form action={formAction} className="space-y-6">
      {channels.map((ch) => (
        <Card key={ch.key}>
          <CardHeader>
            <CardTitle className="text-base">支付渠道 · {ch.displayName}</CardTitle>
            <CardDescription>
              BEpusdt 兼容收银台（LitePay / 自建网关）。令牌加密存储、留空保持不变；
              webhook 地址：<code className="font-mono text-xs">/api/webhooks/pay/{ch.key}</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid max-w-xl gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`${ch.key}-api`}>网关地址（仅域名）</Label>
              <Input id={`${ch.key}-api`} name={`${ch.key}.apiBase`} defaultValue={ch.apiBase} placeholder="https://pay.9527.tr" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`${ch.key}-token`}>对接令牌（API Token）</Label>
              <Input
                id={`${ch.key}-token`}
                name={`${ch.key}.token`}
                type="password"
                placeholder={ch.hasToken ? "已设置（留空则不修改）" : "未设置"}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ch.key}-timeout`}>订单超时（秒，180–3600）</Label>
              <Input id={`${ch.key}-timeout`} name={`${ch.key}.timeout`} type="number" min={180} max={3600} defaultValue={ch.timeoutSeconds} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ch.key}-currencies`}>币种限制（可选）</Label>
              <Input id={`${ch.key}-currencies`} name={`${ch.key}.currencies`} defaultValue={ch.currencies} placeholder="USDT,USDC" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ch.key}-name`}>前台显示名称（可选）</Label>
              <Input id={`${ch.key}-name`} name={`${ch.key}.displayName`} defaultValue={ch.displayName} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ch.key}-sort`}>显示优先级（0–999，小在前）</Label>
              <Input id={`${ch.key}-sort`} name={`${ch.key}.sortOrder`} type="number" min={0} max={999} defaultValue={ch.sortOrder} />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name={`${ch.key}.reselect`} defaultChecked={ch.reselect} className="size-4" />
              允许买家在收银台重选平台与币种
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name={`${ch.key}.enabled`} defaultChecked={ch.enabled} className="size-4" />
              启用该渠道
            </label>
          </CardContent>
        </Card>
      ))}

      {state ? <Flash ok={state.ok ? state.message : undefined} err={state.ok ? undefined : state.message} /> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "正在保存…" : "保存支付渠道设置"}
        </Button>
        <p className="text-xs text-muted">全部渠道统一校验、统一保存；令牌留空表示不修改。</p>
      </div>
    </form>
  );
}
