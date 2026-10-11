/* 开发辅助：造一个自动发卡商品 + 3 张卡密 + 一笔订单，输出 mock 收银台链接 */
import { db } from "../src/db/index";
import { cards, products } from "../src/db/schema";
import { createOrder } from "../src/server/order/create-order";
import { randomUUID } from "node:crypto";

async function main() {
  const slug = "demo-" + randomUUID().slice(0, 6);
  const p = db
    .insert(products)
    .values({
      name: "Demo 会员月卡",
      slug,
      description: "演示商品：自动发卡。",
      priceCents: 990,
      deliveryType: "auto",
      status: "on",
    })
    .returning({ id: products.id })
    .get()!;
  for (const c of ["DEMO-XXXX-1111", "DEMO-XXXX-2222", "DEMO-XXXX-3333"]) {
    db.insert(cards).values({ productId: p.id, content: c }).run();
  }
  const r = await createOrder({ slug, email: "demo@liteshop.dev", quantity: 1 });
  console.log(JSON.stringify({ slug, orderNo: r.orderNo, paymentUrl: r.paymentUrl }));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
