import Link from "next/link";
import { getDashboardStats } from "@/server/admin/catalog";
import { getAdminBase } from "@/lib/admin-path";
import { getSetting, SETTING_KEYS } from "@/server/settings";
import { formatCents } from "@/lib/money";
import { Flash } from "@/components/admin/flash";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata = { title: "仪表盘" };

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const { ok, err } = await searchParams;
  const threshold = Number(getSetting(SETTING_KEYS.cardLowStockThreshold) ?? "5") || 5;
  const stats = getDashboardStats(threshold);
  const base = await getAdminBase();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl tracking-tight">仪表盘</h1>
        <p className="mt-1 text-sm text-muted-foreground">经营概览与预警</p>
      </div>

      <Flash ok={ok} err={err} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="今日订单" value={String(stats.todayOrders)} />
        <StatCard title="今日销售额" value={`¥ ${formatCents(BigInt(stats.todayRevenueCents))}`} />
        <StatCard title="累计订单" value={String(stats.totalOrders)} />
        <StatCard title="累计销售额" value={`¥ ${formatCents(BigInt(stats.totalRevenueCents))}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base">待处理</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row
              label="待人工发货（已支付）"
              value={stats.pendingManual}
              href={`${base}/orders?status=paid`}
            />
            <Row
              label="自动发货中（卡池不足）"
              value={stats.delivering}
              href={`${base}/orders?status=delivering`}
            />
            {stats.pendingManual + stats.delivering === 0 ? (
              <p className="text-muted-foreground">暂无待处理订单</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base">卡密余量预警</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {stats.lowStockProducts.length === 0 ? (
              <p className="text-muted-foreground">各商品余量充足</p>
            ) : (
              stats.lowStockProducts.map((p) => (
                <Link
                  key={p.id}
                  href={`${base}/cards?product=${p.id}`}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent"
                >
                  <span className="truncate">{p.name}</span>
                  <span
                    className={
                      p.availableCards === 0
                        ? "font-mono text-pastel-red-text"
                        : "font-mono text-pastel-yellow-text"
                    }
                  >
                    余 {p.availableCards}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-5">
        <p className="text-xs tracking-[0.05em] text-muted-foreground uppercase">{title}</p>
        <p className="mt-2 font-mono text-xl">{value}</p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-accent"
    >
      <span>{label}</span>
      <span className={value > 0 ? "font-mono text-pastel-blue-text" : "font-mono text-muted-foreground"}>
        {value}
      </span>
    </Link>
  );
}
