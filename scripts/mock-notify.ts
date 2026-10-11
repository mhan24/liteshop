/* 构造带签名的 mock 回调报文并输出（供 curl 测试） */
import { eq } from "drizzle-orm";
import { db } from "../src/db/index";
import { orders } from "../src/db/schema";
import { buildMockNotifyBody } from "../src/server/payment/mock";

const orderNo = process.argv[2];
const status = Number(process.argv[3] ?? 2);
const o = db.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
if (!o?.tradeId) { console.error("订单不存在或无 tradeId"); process.exit(1); }
process.stdout.write(buildMockNotifyBody({ orderNo, tradeId: o.tradeId, amountCents: BigInt(o.totalCents), status: status as 1 | 2 | 3 }));
