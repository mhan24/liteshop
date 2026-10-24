"use server";

import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { rateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { formatMoney } from "@/lib/money";
import { env } from "@/lib/env";
import {
  createOrder,
  cancelPendingOrder,
  resumePayment,
  handlePaymentWebhook,
  OrderError,
} from "@/server/orders";
import { queryOrder, type OrderQueryView } from "@/server/order-query";
import { buildMockNotifyBody } from "@/server/payments/mock";

/**
 * 买家侧 Server Actions。
 * 限流语义：限流命中返回错误让买家重试；绝不用于支付确认决策。
 */

export interface ActionResult<T = undefined> {
  ok: boolean;
  message: string;
  data?: T;
}

const checkoutSchema = z.object({
  email: z.string().email().max(200),
  note: z.string().max(500).optional(),
  channelKey: z.string().max(64).optional(),
  items: z
    .array(z.object({ slug: z.string().min(1).max(200), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(20),
});

export interface CheckoutSuccess {
  orderNo: string;
  queryPassword: string;
  totalDisplay: string;
  paymentUrl: string | null;
  reconciling: boolean;
}

async function clientIp(): Promise<string> {
  return clientIpFromHeaders(await headers());
}

export async function checkoutAction(
  _prev: ActionResult<CheckoutSuccess> | null,
  formData: FormData
): Promise<ActionResult<CheckoutSuccess>> {
  const limited = rateLimit(`checkout:${await clientIp()}`, 10, 10 * 60_000);
  if (!limited.ok) {
    return { ok: false, message: `操作过于频繁，请 ${limited.retryAfterSeconds} 秒后重试` };
  }

  let parsed: z.infer<typeof checkoutSchema>;
  try {
    parsed = checkoutSchema.parse({
      email: formData.get("email"),
      note: formData.get("note") || undefined,
      channelKey: formData.get("channelKey") || undefined,
      items: JSON.parse(String(formData.get("items") ?? "[]")),
    });
  } catch {
    return { ok: false, message: "请检查填写内容（邮箱格式 / 商品数量）" };
  }

  try {
    const result = await createOrder({
      email: parsed.email,
      items: parsed.items,
      note: parsed.note,
      channelKey: parsed.channelKey,
    });
    return {
      ok: true,
      message: result.reconciling
        ? "支付渠道响应超时，订单已保留待对账，请稍后在订单查询页查看"
        : "订单已创建，请完成支付",
      data: {
        orderNo: result.orderNo,
        queryPassword: result.queryPassword,
        totalDisplay: formatMoney(result.totalCents, result.currency),
        paymentUrl: result.paymentUrl,
        reconciling: result.reconciling,
      },
    };
  } catch (err) {
    if (err instanceof OrderError) return { ok: false, message: err.message };
    console.error("[checkout]", err);
    return { ok: false, message: "下单失败，请稍后重试" };
  }
}

export interface QuerySuccess {
  order: OrderQueryView;
  totalDisplay: string;
}

export async function queryOrderAction(
  _prev: ActionResult<QuerySuccess> | null,
  formData: FormData
): Promise<ActionResult<QuerySuccess>> {
  const email = String(formData.get("email") ?? "");
  const limited = rateLimit(`query:${await clientIp()}:${email.trim().toLowerCase()}`, 10, 10 * 60_000);
  if (!limited.ok) {
    return { ok: false, message: `查询过于频繁，请 ${limited.retryAfterSeconds} 秒后重试` };
  }
  const orderNo = String(formData.get("orderNo") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!orderNo.trim() || !password.trim()) {
    return { ok: false, message: "请填写订单号、邮箱与查单密码" };
  }
  const view = await queryOrder(email, orderNo, password);
  if (!view) return { ok: false, message: "订单不存在，或邮箱 / 查单密码不正确" };
  return {
    ok: true,
    message: "查询成功",
    data: { order: view, totalDisplay: formatMoney(view.totalCents, view.currency) },
  };
}

export async function cancelOrderAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const limited = rateLimit(`cancel:${await clientIp()}`, 10, 10 * 60_000);
  if (!limited.ok) return { ok: false, message: "操作过于频繁，请稍后重试" };
  return cancelPendingOrder(String(formData.get("orderNo") ?? ""), String(formData.get("email") ?? ""));
}

export async function resumePaymentAction(
  _prev: ActionResult<{ paymentUrl: string | null }> | null,
  formData: FormData
): Promise<ActionResult<{ paymentUrl: string | null }>> {
  const limited = rateLimit(`resume:${await clientIp()}`, 6, 10 * 60_000);
  if (!limited.ok) return { ok: false, message: "操作过于频繁，请稍后重试" };
  return resumePayment(String(formData.get("orderNo") ?? ""), String(formData.get("email") ?? ""));
}

/** mock 收银台确认支付（仅 PAYMENT_DRIVER=mock；生产环境直接返回） */
export async function mockPayAction(formData: FormData): Promise<void> {
  if (env.PAYMENT_DRIVER !== "mock") return;
  const orderNo = String(formData.get("orderNo") ?? "");
  const ref = String(formData.get("ref") ?? "");
  const status = Number(formData.get("status") ?? 2) as 1 | 2 | 3;
  const rows = await db.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1);
  const order = rows[0];
  if (!order) return;
  const body = buildMockNotifyBody({
    orderNo,
    providerRef: ref,
    amountMinor: order.totalCents,
    currency: order.currency,
    status,
    fiatAmount: order.totalCents / 100,
  });
  await handlePaymentWebhook("mock", body);
}
