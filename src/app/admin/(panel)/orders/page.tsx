import { desc } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, orders } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { csrfToken } from "@/server/admin-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/input";
import { AdminForm } from "@/components/admin/admin-form";
import {
  closeOrderAction,
  resolveReconcilingAction,
  retryDeliveryAction,
} from "@/actions/admin";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "green" | "yellow" | "blue" | "red" }> = {
  pending: { label: "待支付", tone: "neutral" },
  paid: { label: "已付款待发卡", tone: "blue" },
  completed: { label: "已完成", tone: "green" },
  closed: { label: "已关闭", tone: "neutral" },
  reconciling: { label: "待核实", tone: "yellow" },
};

export default async function AdminOrdersPage() {
  const csrf = await csrfToken();
  const rows = await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(100);
  const deliveryRows = await db.select().from(deliveries);
  const deliveryByOrder = new Map(deliveryRows.map((d) => [d.orderId, d]));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">订单管理</h1>
      {rows.length === 0 ? <p className="text-sm text-muted">暂无订单</p> : null}

      <ul className="space-y-4">
        {rows.map((o) => {
          const delivery = deliveryByOrder.get(o.id);
          const status = STATUS_LABEL[o.status] ?? { label: o.status, tone: "neutral" as const };
          return (
            <li key={o.id}>
              <Card>
                <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="font-mono text-sm">{o.orderNo}</CardTitle>
                    <p className="text-xs text-muted">
                      {o.email} · <span className="data">{formatMoney(o.totalCents)}</span> · {o.createdAt.toLocaleString("zh-CN")}
                    </p>
                  </div>
                  <Badge tone={status.tone} live={o.status === "pending" || o.status === "paid"}>{status.label}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {o.note ? <p className="text-sm text-muted">买家备注：{o.note}</p> : null}

                  {o.status === "reconciling" ? (
                    <div className="flex flex-wrap gap-2">
                      <AdminForm action={resolveReconcilingAction} csrf={csrf} submitLabel="网关已到账，发卡" inline confirmText="确认已在网关后台核实该订单到账？确认后将立即发卡，无法撤回。">
                        <input type="hidden" name="orderNo" value={o.orderNo} />
                        <input type="hidden" name="asPaid" value="1" />
                      </AdminForm>
                      <AdminForm action={resolveReconcilingAction} csrf={csrf} submitLabel="网关无此交易，关闭" variant="danger" inline confirmText="确认网关无此交易？订单将关闭，占用的卡密会退回库存。">
                        <input type="hidden" name="orderNo" value={o.orderNo} />
                        <input type="hidden" name="asPaid" value="0" />
                      </AdminForm>
                    </div>
                  ) : null}

                  {o.status === "pending" ? (
                    <AdminForm action={closeOrderAction} csrf={csrf} submitLabel="关闭订单" variant="danger" inline confirmText="确认关闭该待支付订单？占用的卡密将退回库存，订单不可恢复。">
                      <input type="hidden" name="orderNo" value={o.orderNo} />
                    </AdminForm>
                  ) : null}

                  {o.status === "paid" ? (
                    <AdminForm action={retryDeliveryAction} csrf={csrf} submitLabel="重试发卡" inline>
                      <input type="hidden" name="orderNo" value={o.orderNo} />
                    </AdminForm>
                  ) : null}

                  {delivery ? (
                    <details className="faq-item">
                      <summary className="summary-sm">已交付内容</summary>
                      <pre className="data mt-1 whitespace-pre-wrap break-all rounded-sm border border-line bg-sunken p-3 text-xs text-fg">
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
