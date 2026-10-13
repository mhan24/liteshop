import { csrfToken } from "@/lib/session";
import { getSessionVersion } from "@/server/auth";
import {
  changeAdminCredentialsAction,
  savePaymentConfigAction,
  saveSiteSettingsAction,
  saveCopySettingsAction,
  saveSmtpSettingsAction,
  saveTurnstileSettingsAction,
  sendTestEmailAction,
} from "@/actions/admin";
import { getAdminCredentials } from "@/server/auth";
import { DEFAULT_REPO_URL, DEFAULT_SUPPORT_URL } from "@/server/settings";
import { getAdminPath } from "@/lib/admin-path";
import { COPY_FIELDS, getCopyAll } from "@/server/copy";
import { takeFlash } from "@/lib/flash-store";
import { getPaymentConfig, getAllSettings, getSiteCurrency, SETTING_KEYS } from "@/server/settings";
import { Flash } from "@/components/admin/flash";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencySelect } from "@/components/currency-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "系统设置" };

/** 选项卡分组：把原先一长列配置按用途拆开，避免同屏堆叠 */
const TAB_KEYS = ["site", "pay", "security", "notify", "copy"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ flash?: string; tab?: string }>;
}) {
  const { flash: flashId, tab } = await searchParams;
  // 保存后回到原选项卡：由各 save action 通过 ?tab= 传回
  const activeTab: TabKey = (TAB_KEYS as readonly string[]).includes(tab ?? "")
    ? (tab as TabKey)
    : "site";
  const flash = takeFlash(flashId);
  const csrf = await csrfToken(getSessionVersion());
  const settings = getAllSettings();
  const cfg = getPaymentConfig("bepusdt");
  const config = cfg?.configJson ?? {};
  const creds = getAdminCredentials();
  const adminPath = getAdminPath();
  const smtpEnabled = settings["smtp_enabled"] === "1";
  const siteCurrency = getSiteCurrency();
  const copyValues = getCopyAll();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">站点、支付渠道、邮件通知与管理员；按用途分为若干选项卡</p>
      </div>

      <Flash ok={flash?.ok} err={flash?.err} />

      <Tabs defaultValue={activeTab}>
        <TabsList>
          <TabsTrigger value="site">基础</TabsTrigger>
          <TabsTrigger value="pay">支付</TabsTrigger>
          <TabsTrigger value="security">安全</TabsTrigger>
          <TabsTrigger value="notify">通知</TabsTrigger>
          <TabsTrigger value="copy">前台文案</TabsTrigger>
        </TabsList>

        <TabsContent value="site" className="mt-5 space-y-6">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">站点</CardTitle>
          <CardDescription>
            站点地址用于支付回跳与邮件内链接，必须公网可达且建议 HTTPS。默认币种用于新商品定价、订单与 bepusdt 收款（USD/CNY/EUR/GBP/JPY）。
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
              <Label htmlFor="s-currency">默认币种（全站统一）</Label>
              <CurrencySelect name="currency" id="s-currency" defaultValue={siteCurrency} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="s-repo">开源仓库地址</Label>
              <Input
                id="s-repo"
                name="repoUrl"
                defaultValue={settings[SETTING_KEYS.repoUrl] ?? DEFAULT_REPO_URL}
                placeholder={DEFAULT_REPO_URL}
              />
              <p className="text-xs text-muted-foreground">
                页脚「Powered by liteshop」将链接到此地址（新窗口打开）。
                留空则不显示链接；仅接受 http/https 地址。
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="s-support">联系客服地址</Label>
              <Input
                id="s-support"
                name="supportUrl"
                defaultValue={settings[SETTING_KEYS.supportUrl] ?? DEFAULT_SUPPORT_URL}
                placeholder={DEFAULT_SUPPORT_URL}
              />
              <p className="text-xs text-muted-foreground">
                前台页脚与订单相关页面的「联系客服」将指向此地址（新窗口打开）。
                可填 Telegram、工单或邮箱链接；留空则不显示入口；仅接受 http/https 地址。
              </p>
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
        </TabsContent>
        <TabsContent value="pay" className="mt-5 space-y-6">

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
                placeholder={config["token"] ? "已设置（留空则不修改）" : "未设置"}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-timeout">订单超时（秒，180–3600）</Label>
              <Input
                id="b-timeout"
                name="timeout"
                type="number"
                min={180}
                max={3600}
                step={1}
                defaultValue={String(config["timeout_seconds"] ?? 900)}
              />
              <p className="text-xs text-muted-foreground">
                与 bepusdt 网关一致；超出 180–3600 网关会忽略并改用其默认值。
              </p>
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
        </TabsContent>
        <TabsContent value="security" className="mt-5 space-y-6">

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">人机验证（Cloudflare Turnstile）</CardTitle>
          <CardDescription>
            启用后，前台下单表单将插入 Turnstile 挑战，服务端经 siteverify 校验，防机器人刷单。
            密钥获取：Cloudflare 控制台 → Turnstile → Add site（Widget Mode 建议 Managed）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveTurnstileSettingsAction} className="grid max-w-xl gap-4 sm:grid-cols-2">
            <input type="hidden" name="csrf" value={csrf} />
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="turnstileEnabled"
                defaultChecked={settings["turnstile_enabled"] === "1"}
                className="size-4"
              />
              启用下单人机验证
            </label>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="t-site">Site Key（前台公开）</Label>
              <Input id="t-site" name="turnstileSiteKey" defaultValue={settings["turnstile_site_key"] ?? ""} className="font-mono text-xs" autoComplete="off" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="t-secret">Secret Key（服务端校验）</Label>
              <Input id="t-secret" name="turnstileSecretKey" type="password" placeholder={settings["turnstile_secret_key"] ? "已设置（留空则不修改）" : "未设置"} className="font-mono text-xs" autoComplete="off" />
            </div>
            <div className="flex items-end sm:col-span-2">
              <Button type="submit">保存人机验证设置</Button>
            </div>
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
        </TabsContent>
        <TabsContent value="notify" className="mt-5 space-y-6">

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
              <Input
                id="m-pass"
                name="smtpPass"
                type="password"
                placeholder={settings["smtp_pass"] ? "已设置（留空则不修改）" : "未设置"}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                出于安全考虑不回显已保存的密码；留空表示保持原值。
              </p>
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
        </TabsContent>
        <TabsContent value="copy" className="mt-5 space-y-6">

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">前台文案</CardTitle>
          <CardDescription>
            前台所有主要文本均可在此修改；留空将恢复默认文案。保存后立即生效。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveCopySettingsAction} className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <input type="hidden" name="csrf" value={csrf} />
            {COPY_FIELDS.map((f) => (
              <div key={f.key} className={f.multiline ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                <Label htmlFor={`copy-${f.key}`}>{f.label}</Label>
                {f.multiline ? (
                  <Textarea
                    id={`copy-${f.key}`}
                    name={`copy_${f.key}`}
                    rows={2}
                    defaultValue={copyValues[f.key]}
                  />
                ) : (
                  <Input id={`copy-${f.key}`} name={`copy_${f.key}`} defaultValue={copyValues[f.key]} />
                )}
              </div>
            ))}
            <div className="flex items-end sm:col-span-2">
              <Button type="submit">保存前台文案</Button>
            </div>
          </form>
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
