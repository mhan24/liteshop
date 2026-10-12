"use server";

import { createOrder, OrderError } from "@/server/order/create-order";
import type { CreateOrderResult } from "@/server/order/create-order";
import { lookupOrder, type PublicOrderView } from "@/server/order/query-order";
import { cancelPendingOrder } from "@/server/order/fulfill-order";
import { getTurnstileSecretKey, isTurnstileEnforced } from "@/server/settings";
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

  // 人机验证：仅当「开关开启 + Site/Secret 齐备」时强制（与前端渲染条件一致）
  if (isTurnstileEnforced()) {
    const token = String(formData.get("cfToken") ?? "");
    const verify = await verifyTurnstileToken(token, getTurnstileSecretKey());
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

  if (isTurnstileEnforced()) {
    const verify = await verifyTurnstileToken(
      String(formData.get("cfToken") ?? ""),
      getTurnstileSecretKey()
    );
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

/* ===== 过期订单重新发起支付 ===== */

export interface ResumePaymentState {
  error?: string;
  ok?: boolean;
  paymentUrl?: string;
  message?: string;
}

/**
 * 重新发起支付（仅限 pending 且已过期的订单）。
 *
 * 双因子校验订单号 + 邮箱，避免凭订单号替他人发起支付。
 * 重新发起会登记一条新的支付尝试；旧交易保留但对订单不再有影响
 * （其延迟回调因「非当前尝试」被拒绝，见 fulfill-order status=3 分支）。
 */
export async function resumePaymentAction(
  _prev: ResumePaymentState | null,
  formData: FormData
): Promise<ResumePaymentState> {
  const orderNo = String(formData.get("orderNo") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!orderNo || !email) {
    return { error: "请填写订单号与下单邮箱" };
  }

  // 双因子确认归属
  const view = lookupOrder(orderNo, email);
  if (!view) return { error: "订单号与邮箱不匹配" };
  if (view.status === "completed") return { error: "订单已完成，无需重新支付" };
  if (view.status === "paid" || view.status === "delivering") {
    return { error: "支付已确认，请勿重复支付" };
  }
  if (view.status === "closed") {
    return { error: "订单已关闭，请重新下单" };
  }
  if (view.status !== "pending") {
    return { error: `当前状态（${view.statusLabel}）无法重新发起支付` };
  }

  const { resumeOrderPayment } = await import("@/server/order/create-order");
  const result = await resumeOrderPayment(orderNo);
  if (!result.ok || !result.paymentUrl) {
    return { error: result.message };
  }
  return { ok: true, message: result.message, paymentUrl: result.paymentUrl };
}
