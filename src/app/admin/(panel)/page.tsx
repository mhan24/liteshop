import { count, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/input";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "green" | "yellow" | "blue" }> = {
  pending: { label: "待支付", tone: "neutral" },
  paid: { label: "已付款待发卡", tone: "blue" },
  completed: { label: "已完成", tone: "green" },
  closed: { label: "已关闭", tone: "neutral" },
  reconciling: { label: "待核实", tone: "yellow" },
};

export default async function AdminDashboard() {
  const [recent, statusCounts] = await Promise.all([
    db.select().from(orders).orderBy(sql`created_at desc`).limit(15),
    db.select({ status: orders.status, c: count() }).from(orders).groupBy(orders.status),
  ]);
  const counts = Object.fromEntries(statusCounts.map((r) => [r.status, Number(r.c)]));
  const total = statusCounts.reduce((acc, r) => acc + Number(r.c), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">概览</h1>
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="订单总数" value={String(total)} />
        <StatCard label="待支付" value={String(counts["pending"] ?? 0)} />
        <StatCard label="待发卡" value={String(counts["paid"] ?? 0)} />
        <StatCard label="待核实" value={String(counts["reconciling"] ?? 0)} />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">最近订单</h2>
        <ul className="divide-y divide-line rounded-md border border-line bg-surface">
          {recent.length === 0 ? (
            <li className="p-4 text-sm text-muted">暂无订单</li>
          ) : (
            recent.map((o) => {
              const status = STATUS_LABEL[o.status] ?? { label: o.status, tone: "neutral" as const };
              return (
                <li key={o.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-mono text-xs">{o.orderNo}</p>
                    <p className="truncate text-xs text-muted">{o.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span><span className="data">{formatMoney(o.totalCents)}</span></span>
                    <Badge tone={status.tone} live={o.status === "pending" || o.status === "paid"}>
                      {status.label}
                    </Badge>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="data mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
