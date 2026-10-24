import type { Metadata } from "next";
import { OrderQueryClient } from "@/components/shop/order-query-client";
import { getTurnstileClientConfig } from "@/server/settings";

export const metadata: Metadata = {
  title: "订单查询",
  description: "凭订单号、下单邮箱与查单密码，随时查看订单状态与已购卡密。",
  robots: { index: false, follow: false },
};

// 人机验证开关读自数据库：不能静态预渲染
export const dynamic = "force-dynamic";

export default async function OrderQueryPage() {
  const human = await getTurnstileClientConfig();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="text-center">
        <h1 className="font-serif text-2xl font-semibold tracking-[-0.02em]">订单查询</h1>
        <p className="mt-1 text-sm text-muted">输入订单号、下单邮箱与查单密码，查看订单与交付内容</p>
      </header>
      <OrderQueryClient human={human} />
    </div>
  );
}
