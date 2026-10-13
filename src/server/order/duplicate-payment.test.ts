import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { db } from "@/db";
import { cards, orders, paymentAttempts, paymentAnomalies } from "@/db/schema";
import { reissueAnomaly } from "@/server/admin/anomalies";
import { buildMockNotifyBody } from "@/server/payment/mock";
import { seedAuto } from "./test-helpers";
import { createOrder } from "./create-order";
import { handlePaymentNotify } from "./fulfill-order";

for (const missingCurrent of [false, true]) {
it(`历史到账补发后，当前交易另行到账必须登记且只交付一次（缺失尝试=${missingCurrent}）`, async () => {
  const p = seedAuto([randomUUID(), randomUUID()]);
  const r = await createOrder({ slug:p.slug, email:"double@example.test", quantity:1 });
  const o = db.select().from(orders).where(eq(orders.orderNo,r.orderNo)).get()!;
  const old = randomUUID();
  db.insert(paymentAttempts).values({orderNo:o.orderNo,provider:"mock",tradeId:old,
    amountCents:o.totalCents,currency:o.currency,status:"expired",isCurrent:false}).run();
  const notify = (tradeId:string) => handlePaymentNotify("mock",buildMockNotifyBody({
    orderNo:o.orderNo,tradeId,amountCents:BigInt(o.totalCents),currency:o.currency,status:2 }));
  notify(old);
  const a = db.select().from(paymentAnomalies).where(eq(paymentAnomalies.orderNo,o.orderNo)).get()!;
  expect(reissueAnomaly(a.id,"核实旧款").ok).toBe(true);
  if (missingCurrent) db.delete(paymentAttempts).where(eq(paymentAttempts.tradeId,o.tradeId!)).run();
  const delivered = db.select().from(orders).where(eq(orders.orderNo,o.orderNo)).get()!;
  const before = db.select().from(cards).where(eq(cards.productId,p.id)).all();
  expect(notify(o.tradeId!).handled).toBe(false);
  const rows = db.select().from(paymentAnomalies).where(eq(paymentAnomalies.orderNo,o.orderNo)).all();
  expect(rows).toHaveLength(2);
  const extra = rows.find(a=>a.tradeId===o.tradeId)!;
  expect(extra.status).toBe("open");
  expect(extra.kind).toBe("duplicate_payment");
  expect(reissueAnomaly(extra.id,"不能重复补发").ok).toBe(false);
  if (!missingCurrent) expect(db.select().from(paymentAttempts).where(eq(paymentAttempts.tradeId,o.tradeId!)).get()!.status).toBe("paid");
  // 旧数据缺失尝试行时，业务异常去重仍然保证不会产生新事项。
  expect(notify(o.tradeId!).handled).toBe(!missingCurrent);
  expect(db.select().from(paymentAnomalies).where(eq(paymentAnomalies.orderNo,o.orderNo)).all()).toHaveLength(2);
  expect(db.select().from(orders).where(eq(orders.orderNo,o.orderNo)).get()).toEqual(delivered);
  expect(db.select().from(cards).where(eq(cards.productId,p.id)).all()).toEqual(before);
});
}

it("没有支付尝试记录的传统已交付订单仍可按已支付快照幂等处理",async()=>{
  const p=seedAuto([randomUUID()]);
  const r=await createOrder({slug:p.slug,email:"legacy@example.test",quantity:1});
  const o=db.select().from(orders).where(eq(orders.orderNo,r.orderNo)).get()!;
  const notify=()=>handlePaymentNotify("mock",buildMockNotifyBody({orderNo:o.orderNo,tradeId:o.tradeId!,
    amountCents:BigInt(o.totalCents),currency:o.currency,status:2}));
  expect(notify().handled).toBe(true);
  db.delete(paymentAttempts).where(eq(paymentAttempts.orderNo,o.orderNo)).run();
  expect(notify().handled).toBe(true);
  expect(db.select().from(paymentAnomalies).where(eq(paymentAnomalies.orderNo,o.orderNo)).all()).toHaveLength(0);
});
