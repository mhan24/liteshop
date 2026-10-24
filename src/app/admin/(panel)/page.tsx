import { count, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [recent, statusCounts] = await Promise.all([
    db.select().from(orders).orderBy(sql`created_at desc`).limit(15),
    db.select({ status: orders.status, c: count() }).from(orders).groupBy(orders.status),
  ]);
  const counts = Object.fromEntries(statusCounts.map((r) => [r.status, Number(r.c)]));
  const total = statusCounts.reduce((acc, r) => acc + Number(r.c), 0);

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-xl font-semibold">概览</h1>
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="订单总数" value={String(total)} />
        <StatCard label="待支付" value={String(counts["pending"] ?? 0)} />
        <StatCard label="待交付" value={String(counts["paid"] ?? 0)} />
        <StatCard label="待核实" value={String(counts["reconciling"] ?? 0)} />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">最近订单</h2>
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {recent.length === 0 ? (
            <li className="p-4 text-sm text-muted">暂无订单</li>
          ) : (
            recent.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-mono text-xs">{o.orderNo}</p>
                  <p className="truncate text-xs text-muted">{o.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span>{formatMoney(o.totalCents, o.currency)}</span>
                  <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                    {o.status}
                  </span>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-serif text-2xl font-semibold">{value}</p>
    </div>
  );
}
