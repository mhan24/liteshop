import { lookupOrder } from "@/server/order/query-order";
import { Reveal } from "@/components/reveal";
import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";
export const metadata = { title: "订单查询" };

export default async function OrderLookupPage({
  searchParams,
}: {
  searchParams: Promise<{ order_no?: string; email?: string }>;
}) {
  const { order_no: orderNo, email } = await searchParams;
  const order = orderNo && email ? lookupOrder(orderNo, email) : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-20">
      <Reveal>
        <h1 className="font-serif text-3xl tracking-tight">订单查询</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          凭下单时填写的邮箱与订单号，查看支付状态与卡密 / 交付内容
        </p>
      </Reveal>

      <Reveal delay={1} className="mt-8">
        <form className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]" action="/orders" method="get">
          <div className="space-y-1.5">
            <Label htmlFor="q-order">订单号</Label>
            <Input
              id="q-order"
              name="order_no"
              defaultValue={orderNo ?? ""}
              placeholder="LS20261011XXXXXXXXXX"
              className="font-mono text-sm"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-email">下单邮箱</Label>
            <Input
              id="q-email"
              name="email"
              type="email"
              defaultValue={email ?? ""}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" className="w-full sm:w-auto">
              查询
            </Button>
          </div>
        </form>
      </Reveal>

      {orderNo && email && !order ? (
        <Reveal delay={2} className="mt-8">
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <p className="font-serif text-xl">没有找到匹配的订单</p>
            <p className="mt-2 text-sm text-muted-foreground">
              请核对订单号与邮箱是否与下单时一致
            </p>
          </div>
        </Reveal>
      ) : null}

      {order ? (
        <Reveal delay={2} className="mt-8">
          <Card className="border-border bg-card">
            <CardContent className="p-8">
              <div className="flex items-center justify-between gap-4">
                <h2 className="font-serif text-xl">订单详情</h2>
                <StatusBadge status={order.status} label={order.statusLabel} />
              </div>
              <dl className="mt-6 space-y-3 text-sm">
                <Row label="订单号">
                  <span className="font-mono text-xs">{order.orderNo}</span>
                </Row>
                <Row label="商品">
                  {order.productName} × {order.quantity}
                </Row>
                <Row label="金额">
                  <span className="font-mono">
                    {order.currency} {order.totalFormatted}
                  </span>
                </Row>
                <Row label="邮箱">{order.emailMasked}</Row>
                <Row label="下单时间">
                  <span className="font-mono text-xs">
                    {order.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                </Row>
              </dl>

              {order.deliveryContent != null ? (
                <div className="mt-6">
                  <p className="mb-2 text-sm font-medium">卡密 / 交付内容</p>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-secondary p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap select-all">
                    {order.deliveryContent}
                  </pre>
                </div>
              ) : (
                <div className="mt-6 rounded-lg bg-secondary p-4 text-sm leading-relaxed">
                  {order.status === "pending"
                    ? "订单尚未支付，暂无交付内容。"
                    : order.status === "paid"
                      ? "支付已确认，订单处理中；人工商品会尽快发货。"
                      : order.status === "delivering"
                        ? "正在为你发货，请稍后再来查看。"
                        : "暂无交付内容。"}
                </div>
              )}
            </CardContent>
          </Card>
        </Reveal>
      ) : null}
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
