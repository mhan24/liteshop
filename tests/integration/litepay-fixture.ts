import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import { encryptSecret } from "@/lib/secret-box";
import { litepaySign } from "@/lib/litepay-sign";
import { minorToNumber } from "@/lib/money";
import { setSetting, SETTING_KEYS } from "@/server/settings";
import { createOrder } from "@/server/orders";
import { seedAutoProduct } from "../helpers";

/**
 * LitePay 渠道测试夹具：直接建一张 mark 为 litepay 的支付记录，
 * 用真实签名算法构造回调，覆盖真实网关的验签与确认路径
 * （建单走 mock，因为测试环境不访问外网）。
 */
export const LITEPAY_TEST_TOKEN = "litepay-test-token";

async function configureGateway(): Promise<void> {
  await setSetting(SETTING_KEYS.litepayEnabled, "1");
  await setSetting(SETTING_KEYS.litepayApiBase, "https://pay.test.local");
  await setSetting(SETTING_KEYS.litepayTokenEnc, encryptSecret(LITEPAY_TEST_TOKEN));
  await setSetting(SETTING_KEYS.litepayCurrencies, "USDT,USDC");
  await setSetting(SETTING_KEYS.litepayTimeoutSeconds, "600");
  await setSetting(SETTING_KEYS.litepayReselect, "1");
}

async function prepareLitepayOrder(slug: string, quantity = 1, cardCount = 3) {
  await configureGateway();
  await seedAutoProduct(slug, cardCount, 100);
  const r = await createOrder({ email: "buyer@test.dev", items: [{ slug, quantity }] });
  const orderRows = await db.select().from(orders).where(eq(orders.orderNo, r.orderNo));
  const order = orderRows[0]!;
  const providerRef = `LP${Date.now().toString(36)}`;
  await db
    .update(payments)
    .set({ channel: "litepay", providerRef })
    .where(eq(payments.orderId, order.id));
  const payRows = await db.select().from(payments).where(eq(payments.orderId, order.id));
  return { r, order, payment: payRows[0]! };
}

function signedNotify(input: {
  orderNo: string;
  providerRef: string;
  amountCents: number;
  status: number;
}): string {
  const body: Record<string, unknown> = {
    trade_id: input.providerRef,
    order_id: input.orderNo,
    amount: minorToNumber(input.amountCents),
    actual_amount: minorToNumber(input.amountCents),
    token: "TReceiverUID",
    block_transaction_id: "1234567890",
    status: input.status,
  };
  return JSON.stringify({ ...body, signature: litepaySign(body, LITEPAY_TEST_TOKEN) });
}

export const lipayTestHelpers = {
  prepareLitepayOrder,
  signedNotify,
  configureGateway,
  token: LITEPAY_TEST_TOKEN,
};
