import { csrfToken } from "@/lib/session";
import {
  changeAdminCredentialsAction,
  savePaymentConfigAction,
  saveSiteSettingsAction,
  saveSmtpSettingsAction,
  sendTestEmailAction,
} from "@/actions/admin";
import { getAdminCredentials } from "@/server/auth";
import { getAdminPath } from "@/lib/admin-path";
import { getPaymentConfig, getAllSettings, SETTING_KEYS } from "@/server/settings";
import { Flash } from "@/components/admin/flash";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";
export const metadata = { title: "系统设置" };

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { ok, err } = await searchParams;
  const csrf = await csrfToken();
  const settings = getAllSettings();
  const cfg = getPaymentConfig("bepusdt");
  const config = cfg?.configJson ?? {};
  const creds = getAdminCredentials();
  const adminPath = getAdminPath();
  const smtpEnabled = settings["smtp_enabled"] === "1";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">站点、支付渠道、邮件通知与管理员</p>
      </div>

      <Flash ok={ok} err={err} />

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">站点</CardTitle>
          <CardDescription>
            站点地址用于支付回跳与邮件内链接，必须公网可达且建议 HTTPS。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveSiteSettingsAction} className="grid max-w-xl gap-4 sm:grid-cols-2">
            <input type="hidden" name="csrf" value={csrf} />
            <div className="space-y-1.5">
              <Label htmlFor="s-name">站点名称</Label>
              <Input id="s-name" name="siteName" defaultValue={settings[SETTING_KEYS.siteName] ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-url">站点地址</Label>
              <Input
                id="s-url"
                name="siteUrl"
                defaultValue={settings[SETTING_KEYS.siteUrl] ?? ""}
                placeholder="https://shop.9527.tr"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-threshold">卡密低库存阈值</Label>
              <Input
                id="s-threshold"
                name="threshold"
                type="number"
                min={0}
                defaultValue={settings[SETTING_KEYS.cardLowStockThreshold] ?? "5"}
              />
            </div>
            <div className="flex items-end sm:col-span-2">
              <Button type="submit">保存站点设置</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">支付渠道 · bepusdt</CardTitle>
          <CardDescription>
            对接令牌获取：bepusdt 后台 → 系统管理 → 基本设置 → API 设置 → 对接令牌。
            启用后下单将跳转 bepusdt 收银台，买家可在收银台自选币种与网络。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={savePaymentConfigAction} className="grid max-w-xl gap-4 sm:grid-cols-2">
            <input type="hidden" name="csrf" value={csrf} />
            <input type="hidden" name="provider" value="bepusdt" />
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="b-api">API 地址</Label>
              <Input
                id="b-api"
                name="apiBase"
                defaultValue={String(config["api_base"] ?? "")}
                placeholder="http://127.0.0.1:8080 或 https://pay.example.com"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="b-token">对接令牌（API Token）</Label>
              <Input
                id="b-token"
                name="token"
                type="password"
                defaultValue={String(config["token"] ?? "")}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-timeout">订单超时（秒，≥180）</Label>
              <Input
                id="b-timeout"
                name="timeout"
                type="number"
                min={180}
                defaultValue={String(config["timeout_seconds"] ?? 600)}
              />
            </div>
            <label className="flex items-center gap-2 self-end text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={cfg?.enabled ?? false}
                className="size-4"
              />
              启用 bepusdt 渠道（启用后前台下单走该渠道）
            </label>
            <div className="flex items-end sm:col-span-2">
              <Button type="submit">保存渠道配置</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">邮件通知（SMTP）</CardTitle>
          <CardDescription>
            启用后：买家支付成功、卡密/人工交付完成时自动发邮件通知；后台补发邮件也依赖此配置。
            常见端口：465（SSL）/ 587（STARTTLS，取消勾选 SSL）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveSmtpSettingsAction} className="grid max-w-xl gap-4 sm:grid-cols-2">
            <input type="hidden" name="csrf" value={csrf} />
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="smtpEnabled" defaultChecked={smtpEnabled} className="size-4" />
              启用邮件通知
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="m-host">SMTP 服务器</Label>
              <Input
                id="m-host"
                name="smtpHost"
                defaultValue={settings["smtp_host"] ?? ""}
                placeholder="smtp.example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-port">端口</Label>
              <Input id="m-port" name="smtpPort" type="number" defaultValue={settings["smtp_port"] ?? "465"} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-user">SMTP 用户名</Label>
              <Input id="m-user" name="smtpUser" defaultValue={settings["smtp_user"] ?? ""} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-pass">SMTP 密码 / 授权码</Label>
              <Input id="m-pass" name="smtpPass" type="password" defaultValue={settings["smtp_pass"] ?? ""} autoComplete="off" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="m-from">发件人</Label>
              <Input
                id="m-from"
                name="smtpFrom"
                defaultValue={settings["smtp_from"] ?? ""}
                placeholder="noreply@example.com 或 Shop <noreply@example.com>"
              />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="smtpSecure"
                defaultChecked={settings["smtp_secure"] !== "0"}
                className="size-4"
              />
              使用 SSL 直连（465 端口勾选；587 端口取消勾选）
            </label>
            <div className="flex items-end gap-3 sm:col-span-2">
              <Button type="submit">保存邮件设置</Button>
            </div>
          </form>

          <form action={sendTestEmailAction} className="mt-6 flex max-w-xl items-end gap-3 border-t border-border pt-4">
            <input type="hidden" name="csrf" value={csrf} />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="m-test">发送测试邮件到</Label>
              <Input id="m-test" name="testTo" type="email" placeholder="you@example.com" required />
            </div>
            <Button type="submit" variant="outline">
              发送测试
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">管理员与后台入口</CardTitle>
          <CardDescription>
            修改需要验证当前密码；保存后所有登录会话失效，需重新登录。
            后台入口路径即地址伪装：改为自定义值后（如 my-panel），后台地址变为
            <code className="mx-1 rounded bg-secondary px-1 py-0.5 font-mono text-xs">
              {`https://当前域名/${adminPath === "admin" ? "my-panel" : adminPath}`}
            </code>
            ，原 /admin/* 将返回 404。当前入口：/{adminPath}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={changeAdminCredentialsAction} className="grid max-w-xl gap-4 sm:grid-cols-2">
            <input type="hidden" name="csrf" value={csrf} />
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="a-current">当前密码（必填）</Label>
              <Input id="a-current" name="currentPassword" type="password" required autoComplete="current-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-user">新用户名（当前：{creds.username}，留空不改）</Label>
              <Input id="a-user" name="newUsername" placeholder="留空不修改" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-path">后台入口路径（留空不改）</Label>
              <Input id="a-path" name="newPath" placeholder={adminPath === "admin" ? "my-panel" : adminPath} className="font-mono" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-pass">新密码（留空不改）</Label>
              <Input id="a-pass" name="newPassword" type="password" placeholder="至少 8 位" autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="a-confirm">确认新密码</Label>
              <Input id="a-confirm" name="confirmPassword" type="password" autoComplete="new-password" />
            </div>
            <div className="flex items-end sm:col-span-2">
              <Button type="submit">保存管理员设置</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
