import { notFound } from "next/navigation";
import { envConfig } from "@/lib/env";
import { getMockCheckoutData } from "@/server/order/query-order";
import { mockPayAction } from "@/actions/mock-pay";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export const dynamic = "force-dynamic";

export const metadata = { title: "模拟收银台" };

/**
 * 本地模拟收银台（PAYMENT_DRIVER=mock 专用）：验证「下单 → 支付 → 回调 → 发货」
 * 全链路，生产环境该路由 404。
 */
export default async function MockPayPage({
  searchParams,
}: {
  searchParams: Promise<{ order_no?: string }>;
}) {
  if (!envConfig.mockPayment) notFound();
  const { order_no: orderNo } = await searchParams;
  const order = orderNo ? getMockCheckoutData(orderNo) : null;
  if (!order) notFound();

  const pending = order.status === "pending";

  return (
    <main className="min-h-[100dvh] flex items-center justify-center bg-background px-4 py-16">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader>
          <CardTitle className="font-serif text-2xl tracking-tight">
            模拟收银台
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            开发模式，不产生真实交易
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">订单号</dt>
              <dd className="font-mono text-xs">{order.orderNo}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">商品</dt>
              <dd>
                {order.productName} × {order.quantity}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">应付</dt>
              <dd className="font-mono">
                {order.currency} {order.totalFormatted}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">状态</dt>
              <dd>
                <Badge
                  className={
                    pending
                      ? "bg-pastel-yellow-bg text-pastel-yellow-text"
                      : "bg-pastel-green-bg text-pastel-green-text"
                  }
                >
                  {order.statusLabel}
                </Badge>
              </dd>
            </div>
          </dl>

          {pending ? (
            <form action={mockPayAction} className="space-y-3">
              <input type="hidden" name="orderNo" value={order.orderNo} />
              <Separator />
              <Button type="submit" name="outcome" value="2" className="w-full">
                模拟支付成功
              </Button>
              <Button
                type="submit"
                name="outcome"
                value="3"
                variant="outline"
                className="w-full"
              >
                模拟支付超时
              </Button>
            </form>
          ) : (
            <Button asChild variant="outline" className="w-full">
              <a href={`/pay/return?order_no=${encodeURIComponent(order.orderNo)}`}>
                查看订单状态
              </a>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
