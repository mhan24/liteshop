import { getAllSettings, SETTING_KEYS } from "@/server/settings";
import { csrfToken } from "@/server/admin-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { AdminForm } from "@/components/admin/admin-form";
import {
  changeCredentialsAction,
  saveSiteSettingsAction,
  saveSmtpAction,
  sendTestEmailAction,
} from "@/actions/admin";
import { SUPPORTED_CURRENCIES } from "@/server/settings";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const csrf = await csrfToken();
  const s = await getAllSettings();

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-xl font-semibold">设置</h1>

      <Card>
        <CardHeader>
          <CardTitle>站点</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminForm action={saveSiteSettingsAction} csrf={csrf} submitLabel="保存站点设置" className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-name">站点名称</Label>
              <Input id="s-name" name="siteName" defaultValue={s[SETTING_KEYS.siteName] ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-url">站点地址（canonical / 回调用）</Label>
              <Input id="s-url" name="siteUrl" type="url" defaultValue={s[SETTING_KEYS.siteUrl] ?? ""} placeholder="https://shop.example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-currency">默认币种（全站统一）</Label>
              <Select id="s-currency" name="currency" defaultValue={s[SETTING_KEYS.currency] ?? "USD"}>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-threshold">卡密低库存阈值</Label>
              <Input id="s-threshold" name="threshold" type="number" min={0} defaultValue={s[SETTING_KEYS.cardLowStockThreshold] ?? "5"} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="s-support">联系客服地址（可选）</Label>
              <Input id="s-support" name="supportUrl" type="url" defaultValue={s[SETTING_KEYS.supportUrl] ?? ""} />
            </div>
          </AdminForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>邮件通知（SMTP）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <AdminForm action={saveSmtpAction} csrf={csrf} submitLabel="保存邮件设置" className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="smtpEnabled" defaultChecked={s[SETTING_KEYS.smtpEnabled] === "1"} className="size-4" />
              启用邮件通知（交付内容发送至买家邮箱）
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
              <Input id="smtp-pass" name="smtpPass" type="password" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-from">发件人</Label>
              <Input id="smtp-from" name="smtpFrom" defaultValue={s[SETTING_KEYS.smtpFrom] ?? ""} placeholder="noreply@example.com" />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="smtpSecure" defaultChecked={s[SETTING_KEYS.smtpSecure] !== "0"} className="size-4" />
              使用 TLS（465 端口）
            </label>
          </AdminForm>
          <AdminForm action={sendTestEmailAction} csrf={csrf} submitLabel="发送测试邮件" className="max-w-sm">
            <div className="space-y-1.5">
              <Label htmlFor="test-to">测试收件邮箱</Label>
              <Input id="test-to" name="testTo" type="email" required />
            </div>
          </AdminForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>管理员凭据</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminForm action={changeCredentialsAction} csrf={csrf} submitLabel="更新凭据" className="grid max-w-md gap-3">
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
            <p className="text-xs text-muted">修改后所有会话将失效并要求重新登录。</p>
          </AdminForm>
        </CardContent>
      </Card>
    </div>
  );
}
