import type { Metadata } from "next";
import { OrderQueryClient } from "@/components/shop/order-query-client";
import { getTurnstileClientConfig } from "@/server/settings";

export const metadata: Metadata = {
  title: "订单查询",
  description: "凭订单号、下单邮箱和查单密码查询订单状态与已发放的卡密。",
  robots: { index: false, follow: false },
};

// 人机验证开关读自数据库：不能静态预渲染
export const dynamic = "force-dynamic";

export default async function OrderQueryPage() {
  const human = await getTurnstileClientConfig();
  return (
    <div className="mx-auto max-w-xl space-y-8">
      <header className="space-y-2 border-b border-line pb-6">
        <p className="eyebrow">订单查询</p>
        <h1 className="text-3xl font-semibold tracking-[-0.025em]">查询订单与卡密</h1>
        <p className="text-sm leading-6 text-muted">
          请填写订单号、下单邮箱和下单后显示的 8 位查单密码，三项均需核对一致。
        </p>
      </header>
      <OrderQueryClient human={human} />
    </div>
  );
}
