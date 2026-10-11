"use server";

import { createOrder, OrderError } from "@/server/order/create-order";
import type { CreateOrderResult } from "@/server/order/create-order";

/** 前台下单 Action（游客模式）：成功后由客户端跳转支付收银台 */

export interface CreateOrderState {
  error?: string;
  paymentUrl?: string;
  orderNo?: string;
}

export async function createOrderAction(
  _prev: CreateOrderState | null,
  formData: FormData
): Promise<CreateOrderState> {
  const slug = String(formData.get("slug") ?? "");
  const email = String(formData.get("email") ?? "");
  const note = String(formData.get("note") ?? "");
  const quantity = Number(formData.get("quantity") ?? 1);

  try {
    const result: CreateOrderResult = await createOrder({ slug, email, quantity, note });
    return { paymentUrl: result.paymentUrl, orderNo: result.orderNo };
  } catch (err) {
    if (err instanceof OrderError) return { error: err.message };
    console.error("[createOrderAction]", err);
    return { error: "下单失败，请稍后重试" };
  }
}
