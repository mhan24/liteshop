"use server";

import { createOrder, OrderError } from "@/server/order/create-order";
import type { CreateOrderResult } from "@/server/order/create-order";
import { lookupOrder, type PublicOrderView } from "@/server/order/query-order";
import { cancelPendingOrder } from "@/server/order/fulfill-order";
import { getTurnstileSecretKey } from "@/server/settings";
import { verifyTurnstileToken } from "@/lib/turnstile";

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

  // 人机验证（后台启用 Turnstile 后强制）
  const secret = getTurnstileSecretKey();
  if (secret !== "") {
    const token = String(formData.get("cfToken") ?? "");
    const verify = await verifyTurnstileToken(token, secret);
    if (!verify.ok) {
      return { error: "人机验证未通过，请重新完成验证后提交" };
    }
  }

  try {
    const result: CreateOrderResult = await createOrder({ slug, email, quantity, note });
    // 先落「待支付页」：从收银台回退/误关后仍可继续支付
    return {
      paymentUrl: `/pay/pending?order_no=${encodeURIComponent(result.orderNo)}`,
      orderNo: result.orderNo,
    };
  } catch (err) {
    if (err instanceof OrderError) return { error: err.message };
    console.error("[createOrderAction]", err);
    return { error: "下单失败，请稍后重试" };
  }
}

/* ===== 查单（订单号 + 邮箱 + 人机验证）===== */

export interface LookupState {
  error?: string;
  order?: PublicOrderView;
}

export async function lookupOrderAction(
  _prev: LookupState | null,
  formData: FormData
): Promise<LookupState> {
  const orderNo = String(formData.get("orderNo") ?? "");
  const email = String(formData.get("email") ?? "");

  const secret = getTurnstileSecretKey();
  if (secret !== "") {
    const verify = await verifyTurnstileToken(String(formData.get("cfToken") ?? ""), secret);
    if (!verify.ok) {
      return { error: "人机验证未通过，请重新完成验证后查询" };
    }
  }

  if (!orderNo.trim() || !email.trim()) {
    return { error: "请填写订单号与下单邮箱" };
  }
  const order = lookupOrder(orderNo, email);
  if (!order) {
    return { error: "没有找到匹配的订单，请核对订单号与邮箱" };
  }
  return { order };
}

/* ===== 买家取消订单（仅未支付）===== */

export interface CancelOrderState {
  error?: string;
  ok?: boolean;
  message?: string;
}

export async function cancelOrderAction(
  _prev: CancelOrderState | null,
  formData: FormData
): Promise<CancelOrderState> {
  const orderNo = String(formData.get("orderNo") ?? "");
  const email = String(formData.get("email") ?? "");

  if (!orderNo.trim() || !email.trim()) {
    return { error: "请填写订单号与下单邮箱后再取消" };
  }

  const result = cancelPendingOrder(orderNo, email);
  if (!result.ok) return { error: result.message };
  return { ok: true, message: result.message };
}
