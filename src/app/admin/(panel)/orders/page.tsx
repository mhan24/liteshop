import { desc } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, orders } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { csrfToken } from "@/server/admin-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Label, Textarea } from "@/components/ui/input";
import { AdminForm } from "@/components/admin/admin-form";
import {
  closeOrderAction,
  manualDeliverAction,
  resolveReconcilingAction,
  retryDeliveryAction,
} from "@/actions/admin";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const csrf = await csrfToken();
  const rows = await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(100);
  const deliveryRows = await db.select().from(deliveries);
  const deliveryByOrder = new Map(deliveryRows.map((d) => [d.orderId, d]));

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-xl font-semibold">订单</h1>
      {rows.length === 0 ? <p className="text-sm text-muted">暂无订单</p> : null}
      <ul className="space-y-4">
        {rows.map((o) => {
          const delivery = deliveryByOrder.get(o.id);
          return (
            <li key={o.id}>
              <Card>
                <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="font-mono text-sm">{o.orderNo}</CardTitle>
                    <p className="text-xs text-muted">
                      {o.email} · {formatMoney(o.totalCents, o.currency)} ·{" "}
                      {o.createdAt.toLocaleString("zh-CN")}
                    </p>
                  </div>
                  <Badge>{o.status}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {o.note ? <p className="text-sm text-muted">备注：{o.note}</p> : null}
                  {o.status === "reconciling" ? (
                    <div className="flex flex-wrap gap-2">
                      <AdminForm action={resolveReconcilingAction} csrf={csrf} submitLabel="确认已到账并交付">
                        <input type="hidden" name="orderNo" value={o.orderNo} />
                        <input type="hidden" name="asPaid" value="1" />
                      </AdminForm>
                      <AdminForm action={resolveReconcilingAction} csrf={csrf} submitLabel="确认未建单，关闭">
                        <input type="hidden" name="orderNo" value={o.orderNo} />
                        <input type="hidden" name="asPaid" value="0" />
                      </AdminForm>
                    </div>
                  ) : null}
                  {o.status === "pending" ? (
                    <AdminForm action={closeOrderAction} csrf={csrf} submitLabel="关闭订单">
                      <input type="hidden" name="orderNo" value={o.orderNo} />
                    </AdminForm>
                  ) : null}
                  {o.status === "paid" ? (
                    <div className="space-y-3">
                      <AdminForm action={retryDeliveryAction} csrf={csrf} submitLabel="重试自动交付">
                        <input type="hidden" name="orderNo" value={o.orderNo} />
                      </AdminForm>
                      <AdminForm action={manualDeliverAction} csrf={csrf} submitLabel="人工交付">
                        <input type="hidden" name="orderNo" value={o.orderNo} />
                        <div className="space-y-1.5">
                          <Label htmlFor={`content-${o.id}`}>交付内容</Label>
                          <Textarea id={`content-${o.id}`} name="content" rows={3} required />
                        </div>
                      </AdminForm>
                    </div>
                  ) : null}
                  {delivery && o.status === "completed" ? (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted">查看已交付内容</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg border border-line bg-bg p-3 text-xs">
                        {delivery.content}
                      </pre>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
