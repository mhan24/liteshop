import { csrfToken } from "@/server/admin-auth";
import { listAllChannels } from "@/server/payments";
import { isEncryptedSecret } from "@/lib/secret-box";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { AdminForm } from "@/components/admin/admin-form";
import { PaymentChannelsForm } from "@/components/admin/payment-channels-form";
import { createChannelAction, deleteChannelAction } from "@/actions/admin";

export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage() {
  const csrf = await csrfToken();
  const rows = await listAllChannels();
  const channelRows = rows
    .filter((r) => r.type !== "mock")
    .map((r) => ({
      key: r.key,
      displayName: r.displayName,
      apiBase: r.apiBase ?? "",
      hasToken: isEncryptedSecret(r.tokenEnc),
      currencies: r.currencies ?? "",
      timeoutSeconds: r.timeoutSeconds,
      reselect: r.reselect,
      enabled: r.enabled,
      sortOrder: r.sortOrder,
    }));

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-xl font-semibold">支付渠道</h1>

      {channelRows.length > 0 ? <PaymentChannelsForm channels={channelRows} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>新增渠道</CardTitle>
        </CardHeader>
        <CardContent>
          <AdminForm action={createChannelAction} csrf={csrf} submitLabel="创建渠道" className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ch-key">渠道标识（webhook 路径用）</Label>
              <Input id="ch-key" name="key" required pattern="[a-z0-9][a-z0-9-]{1,31}" placeholder="litepay" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ch-name">显示名称</Label>
              <Input id="ch-name" name="displayName" required placeholder="LitePay 收银台" />
            </div>
          </AdminForm>
          {channelRows.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {channelRows.map((ch) => (
                <li key={ch.key} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                  <span>
                    {ch.displayName}{" "}
                    <span className="font-mono text-xs text-muted">
                      /{ch.key} · {ch.enabled ? "启用" : "停用"}
                    </span>
                  </span>
                  <AdminForm action={deleteChannelAction} csrf={csrf} submitLabel="删除">
                    <input type="hidden" name="id" value={rows.find((r) => r.key === ch.key)?.id ?? ""} />
                  </AdminForm>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
