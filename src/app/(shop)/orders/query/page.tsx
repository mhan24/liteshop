import type { Metadata } from "next";
import { OrderQueryClient } from "@/components/shop/order-query-client";
import { getTurnstileClientConfig } from "@/server/settings";

export const metadata: Metadata = {
  title: "订单查询",
  description: "用订单号、下单邮箱与查单密码查看订单状态和已发放的卡密。",
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
        <h1 className="text-3xl font-semibold tracking-[-0.025em]">找回订单与卡密</h1>
        <p className="text-sm leading-6 text-muted">
          三项都要填对：订单号、下单时用的邮箱、建单时显示的 8 位查单密码。缺一项都查不到。
        </p>
      </header>
      <OrderQueryClient human={human} />
    </div>
  );
}
