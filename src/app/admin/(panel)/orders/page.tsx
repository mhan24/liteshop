import Link from "next/link";
import { csrfToken } from "@/lib/session";
import { getSessionVersion } from "@/server/auth";
import { getAdminBase } from "@/lib/admin-path";
import { takeFlash } from "@/lib/flash-store";
import { listOrdersForAdmin } from "@/server/admin/catalog";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { Flash } from "@/components/admin/flash";
import { OrderRowActions } from "@/components/admin/order-row-actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { resendDeliveryEmailAction } from "@/actions/admin";
import { Button } from "@/components/ui/button";
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
  searchParams: Promise<{ status?: string; q?: string; flash?: string }>;
}) {
  const params = await searchParams;
  const flash = takeFlash(params.flash);
  const csrf = await csrfToken(getSessionVersion());
  const base = await getAdminBase();
  const status = params.status ?? "";
  const q = params.q ?? "";
  const orders = listOrdersForAdmin({ status: status || undefined, q: q || undefined });

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
