import { csrfToken } from "@/server/admin-auth";
import { getGatewayStatus, webhookPath } from "@/server/payments";
import { getSiteUrl, getAllSettings, SETTING_KEYS } from "@/server/settings";
import { isEncryptedSecret } from "@/lib/secret-box";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Input, Label } from "@/components/ui/input";
import { AdminForm } from "@/components/admin/admin-form";
import {
  changeCredentialsAction,
  saveLitepayAction,
  saveSiteSettingsAction,
  saveSmtpAction,
  saveTurnstileAction,
  sendTestEmailAction,
} from "@/actions/admin";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const csrf = await csrfToken();
  const [s, gateway, siteUrl] = await Promise.all([getAllSettings(), getGatewayStatus(), getSiteUrl()]);
  const webhookUrl = `${siteUrl}${webhookPath("litepay")}`;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">设置</h1>

      <Card>
        <CardHeader>
          <CardTitle>站点</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminForm
            action={saveSiteSettingsAction}
            csrf={csrf}
            submitLabel="保存站点设置"
            className="grid gap-3 sm:grid-cols-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="s-name">站点名称</Label>
              <Input id="s-name" name="siteName" defaultValue={s[SETTING_KEYS.siteName] ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-url">站点地址（canonical / 支付回调用）</Label>
              <Input
                id="s-url"
                name="siteUrl"
                type="url"
                defaultValue={s[SETTING_KEYS.siteUrl] ?? ""}
                placeholder="https://shop.example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-threshold">卡密低库存提醒阈值</Label>
              <Input
                id="s-threshold"
                name="threshold"
                type="number"
                min={0}
                defaultValue={s[SETTING_KEYS.cardLowStockThreshold] ?? "5"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-support">客服地址（可选）</Label>
              <Input
                id="s-support"
                name="supportUrl"
                type="url"
                defaultValue={s[SETTING_KEYS.supportUrl] ?? ""}
                placeholder="https://t.me/…"
              />
            </div>
            <p className="text-xs leading-5 text-muted sm:col-span-2">
              全部商品以美元（USD）计价，收银台按 USD 建单，不再提供币种切换。
            </p>
          </AdminForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            支付网关 · LitePay
            <Badge tone={gateway.ready ? "green" : "yellow"}>
              {gateway.driver === "mock" ? "模拟网关（开发）" : gateway.ready ? "已启用" : "未启用"}
            </Badge>
          </CardTitle>
          <CardDescription>
            BEpusdt 兼容收银台。接口令牌加密后存库，页面不回显；回调地址固定为{" "}
            <code className="font-mono text-xs">{webhookPath("litepay")}</code>。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <AdminForm action={saveLitepayAction} csrf={csrf} submitLabel="保存网关配置" className="grid max-w-xl gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="lp-api">网关地址（只填域名与端口）</Label>
              <Input
                id="lp-api"
                name="litepayApiBase"
                defaultValue={s[SETTING_KEYS.litepayApiBase] ?? ""}
                placeholder="https://pay.example.com"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="lp-token">接口令牌（后台「接入」页生成）</Label>
              <Input
                id="lp-token"
                name="litepayToken"
                type="password"
                autoComplete="off"
                placeholder={gateway.hasToken ? "已保存，留空保持不变（输入 __CLEAR__ 清除）" : "未设置"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lp-timeout">订单有效期（秒，120–86400）</Label>
              <Input
                id="lp-timeout"
                name="litepayTimeout"
                type="number"
                min={120}
                max={86400}
                defaultValue={gateway.timeoutSeconds}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lp-currencies">收银台币种（可选）</Label>
              <Input
                id="lp-currencies"
                name="litepayCurrencies"
                defaultValue={s[SETTING_KEYS.litepayCurrencies] ?? ""}
                placeholder="USDT,USDC"
              />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="litepayReselect"
                defaultChecked={gateway.reselect}
                className="size-4"
              />
              允许买家在收银台重选平台与币种
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="litepayEnabled"
                defaultChecked={gateway.type === "litepay" && gateway.ready}
                className="size-4"
              />
              启用网关（停用期间前台无法下单）
            </label>
            <p className="text-xs leading-5 text-muted sm:col-span-2">
              回调地址：<span className="font-mono">{webhookUrl}</span>
              。请把该地址与本站地址一并填进网关后台的商店设置，令牌两处必须一致。
            </p>
          </AdminForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>邮件通知（SMTP）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <AdminForm
            action={saveSmtpAction}
            csrf={csrf}
            submitLabel="保存邮件设置"
            className="grid gap-3 sm:grid-cols-2"
          >
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="smtpEnabled"
                defaultChecked={s[SETTING_KEYS.smtpEnabled] === "1"}
                className="size-4"
              />
              启用邮件通知（卡密同时发到买家邮箱）
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-host">SMTP 服务器</Label>
              <Input id="smtp-host" name="smtpHost" defaultValue={s[SETTING_KEYS.smtpHost] ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-port">端口</Label>
              <Input id="smtp-port" name="smtpPort" type="number" defaultValue={s[SETTING_KEYS.smtpPort] ?? "465"} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-user">用户名</Label>
              <Input id="smtp-user" name="smtpUser" defaultValue={s[SETTING_KEYS.smtpUser] ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-pass">密码（留空保持不变）</Label>
              <Input
                id="smtp-pass"
                name="smtpPass"
                type="password"
                autoComplete="off"
                placeholder={isEncryptedSecret(s[SETTING_KEYS.smtpPass]) ? "已保存，留空保持不变（输入 __CLEAR__ 清除）" : "未设置"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-from">发件人</Label>
              <Input
                id="smtp-from"
                name="smtpFrom"
                defaultValue={s[SETTING_KEYS.smtpFrom] ?? ""}
                placeholder="noreply@example.com"
              />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="smtpSecure"
                defaultChecked={s[SETTING_KEYS.smtpSecure] !== "0"}
                className="size-4"
              />
              使用 TLS（465 端口）
            </label>
          </AdminForm>
          <AdminForm action={sendTestEmailAction} csrf={csrf} submitLabel="发送测试邮件" variant="outline" className="max-w-sm">
            <div className="space-y-1.5">
              <Label htmlFor="test-to">测试收件邮箱</Label>
              <Input id="test-to" name="testTo" type="email" required />
            </div>
          </AdminForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>人机验证（Cloudflare Turnstile）</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminForm
            action={saveTurnstileAction}
            csrf={csrf}
            submitLabel="保存人机验证设置"
            className="grid max-w-xl gap-3"
          >
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="tsEnabled"
                defaultChecked={s[SETTING_KEYS.turnstileEnabled] === "1"}
                className="size-4"
              />
              启用人机验证（下单与订单查询需先完成验证）
            </label>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ts-site">Site Key（公开，随页面下发）</Label>
              <Input
                id="ts-site"
                name="tsSiteKey"
                defaultValue={s[SETTING_KEYS.turnstileSiteKey] ?? ""}
                autoComplete="off"
                placeholder="0x…"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ts-secret">
                Secret Key {isEncryptedSecret(s[SETTING_KEYS.turnstileSecretKey]) ? "（已配置：留空保持不变）" : ""}
              </Label>
              <Input
                id="ts-secret"
                name="tsSecretKey"
                type="password"
                autoComplete="off"
                placeholder={isEncryptedSecret(s[SETTING_KEYS.turnstileSecretKey]) ? "留空保持不变，输入 __CLEAR__ 清除" : ""}
              />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="tsFallback"
                defaultChecked={s[SETTING_KEYS.turnstileFallbackEnabled] === "1"}
                className="size-4"
              />
              降级开关：验证组件加载失败时仍允许提交（由频率限制兜底）
            </label>
            <p className="text-xs leading-5 text-muted sm:col-span-2">
              在 Cloudflare 控制台创建 Turnstile Widget 后填两把 Key，并把本站域名加入该 Site Key 的允许列表。
            </p>
          </AdminForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>管理员凭据</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminForm action={changeCredentialsAction} csrf={csrf} submitLabel="更新凭据" confirmText="更新后所有已登录会话（包括当前）都会退出，确认继续？" className="grid max-w-md gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cur-pass">当前密码</Label>
              <Input id="cur-pass" name="currentPassword" type="password" required autoComplete="current-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-user">新用户名（可选）</Label>
              <Input id="new-user" name="newUsername" autoComplete="username" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-pass">新密码（可选，≥8 位）</Label>
              <Input id="new-pass" name="newPassword" type="password" autoComplete="new-password" />
            </div>
            <p className="text-xs text-muted">保存后所有会话失效，需要重新登录。</p>
          </AdminForm>
        </CardContent>
      </Card>
    </div>
  );
}
