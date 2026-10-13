import Link from "next/link";
import { csrfToken } from "@/lib/session";
import { getSessionVersion } from "@/server/auth";
import { getAdminBase } from "@/lib/admin-path";
import { listAnomalies } from "@/server/admin/anomalies";
import {
  reissueAnomalyAction,
  acceptAnomalyManualAction,
  resolveAnomalyAction,
} from "@/actions/admin";
import { takeFlash } from "@/lib/flash-store";
import { listOrdersForAdmin } from "@/server/admin/catalog";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { Flash } from "@/components/admin/flash";
import { OrderRowActions } from "@/components/admin/order-row-actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { resendDeliveryEmailAction } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "订单管理" };

const TABS = [
  { key: "", label: "全部" },
  { key: "pending", label: "待支付" },
  // 待对账需人工核对网关，独立标签便于快速定位
  { key: "reconciling", label: "待对账" },
  { key: "paid", label: "待处理" },
  { key: "delivering", label: "发货中" },
  { key: "completed", label: "已完成" },
  { key: "expired", label: "已超时" },
  { key: "closed", label: "已关闭" },
];

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; flash?: string; anomaly?: string }>;
}) {
  const params = await searchParams;
  const flash = takeFlash(params.flash);
  const csrf = await csrfToken(getSessionVersion());
  const base = await getAdminBase();
  const status = params.status ?? "";
  const q = params.q ?? "";
  const orders = listOrdersForAdmin({ status: status || undefined, q: q || undefined });
  // 异常到账（超时后到账）：需人工核对链上到账后补发或退款
  const anomalyStatus = params.anomaly ?? "open";
  const anomalies = anomalyStatus === "all" ? listAnomalies() : listAnomalies({ status: anomalyStatus });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl tracking-tight">订单</h1>
          <p className="mt-1 text-sm text-muted-foreground">近 {orders.length} 条{status ? ` · ${TABS.find((t) => t.key === status)?.label}` : ""}</p>
        </div>
        <form className="flex gap-2" action={`${base}/orders`}>
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <Input
            name="q"
            defaultValue={q}
            placeholder="搜索订单号 / 邮箱"
            className="w-56 font-mono text-sm"
          />
          <Button type="submit" variant="outline">
            搜索
          </Button>
        </form>
      </div>

      <Flash ok={flash?.ok} err={flash?.err} />

      {anomalies.length > 0 ? (
        <Card className="border-pastel-red-text/30 bg-pastel-red-bg/40">
          <CardHeader>
            <CardTitle className="text-base">
              ⚠ 异常到账待处理（{anomalies.length}）
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              这些订单收到经过交易归属和金额校验的历史、迟到或重复付款通知。
              已释放的卡密可能已被他人买走，因此请先核对链上到账再处置。
              已完成的订单不再补发，请核对是否需要退款：
              自动卡密商品用「补发商品」（从卡池重新取卡）；
              人工发货商品用「转入人工发货」后到订单页录入内容；
              已退款的请用「确认已退款」并填写链上凭证（系统不会自动退款）。
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {anomalies.map((a) => (
              <div
                key={a.id}
                className="rounded-lg border border-border bg-card p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="font-mono text-xs">{a.orderNo}</div>
                    <div className="text-xs">
                      {a.kind === "duplicate_payment" ? "另一笔付款（请核对退款）" : "迟到或历史交易到账"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.productName ?? "—"} · {a.amount} {a.currency} · 回调时状态{" "}
                      {a.orderStatusAtArrival}
                      {a.tradeId ? ` · 交易 ${a.tradeId}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(a.createdAt) ?? ""} · 邮箱 {a.email ?? "—"} ·
                      当前订单状态 {a.orderStatus ?? "—"}
                    </div>
                    {a.status !== "open" ? (
                      <div className="text-xs">
                        处置：{a.status}
                        {a.resolution ? ` · ${a.resolution}` : ""}
                      </div>
                    ) : null}
                  </div>
                  {a.status === "open" ? (
                    <div className="flex flex-wrap gap-2">
                      {a.orderStatus !== "completed" && a.kind !== "duplicate_payment" ? (
                        <>
                          <form action={reissueAnomalyAction} className="flex items-center gap-1">
                            <input type="hidden" name="csrf" value={csrf} />
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="orderNo" value={a.orderNo} />
                            <input
                              name="note"
                              placeholder="补发备注"
                              className="w-28 rounded-md border border-input bg-transparent px-2 py-1 text-xs"
                            />
                            <Button type="submit" size="sm">
                              补发商品
                            </Button>
                          </form>
                          <form action={acceptAnomalyManualAction} className="flex items-center gap-1">
                            <input type="hidden" name="csrf" value={csrf} />
                            <input type="hidden" name="id" value={a.id} />
                            <input
                              name="note"
                              placeholder="备注"
                              className="w-24 rounded-md border border-input bg-transparent px-2 py-1 text-xs"
                            />
                            <Button type="submit" size="sm" variant="outline">
                              转入人工发货
                            </Button>
                          </form>
                        </>
                      ) : null}
                      <form action={resolveAnomalyAction} className="flex items-center gap-1">
                        <input type="hidden" name="csrf" value={csrf} />
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="kind" value="refunded" />
                        <input
                          name="note"
                          placeholder="退款交易哈希"
                          className="w-32 rounded-md border border-input bg-transparent px-2 py-1 font-mono text-xs"
                        />
                        <Button type="submit" size="sm" variant="outline">
                          确认已退款
                        </Button>
                      </form>
                      <form action={resolveAnomalyAction} className="flex items-center gap-1">
                        <input type="hidden" name="csrf" value={csrf} />
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="kind" value="dismissed" />
                        <Button type="submit" size="sm" variant="ghost">
                          误报
                        </Button>
                      </form>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`${base}/orders${t.key ? `?status=${t.key}` : ""}`}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm",
              status === t.key
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>订单号</TableHead>
              <TableHead>商品</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead>买家邮箱</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">下单时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  暂无订单
                </TableCell>
              </TableRow>
            ) : (
              orders.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.orderNo}</TableCell>
                  <TableCell>
                    <p className="max-w-48 truncate">{o.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      × {o.quantity} · {o.deliveryType === "auto" ? "自动发卡" : "人工发货"}
                    </p>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMoney(BigInt(o.totalCents), o.currency)}
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-sm" title={o.email}>
                    {o.email}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={o.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {formatDateTime(o.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-end gap-1">
                      <OrderRowActions
                        csrf={csrf}
                        orderNo={o.orderNo}
                        status={o.status}
                        deliveryType={o.deliveryType}
                      />
                      {o.status === "completed" ? (
                        <form action={resendDeliveryEmailAction}>
                          <input type="hidden" name="csrf" value={csrf} />
                          <input type="hidden" name="orderNo" value={o.orderNo} />
                          <button
                            type="submit"
                            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                          >
                            补发交付邮件
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
