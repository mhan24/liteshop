"use server";

import { createOrder, createOrderForRepurchase, OrderError } from "@/server/order/create-order";
import type { CreateOrderResult } from "@/server/order/create-order";
import { lookupOrder, type PublicOrderView } from "@/server/order/query-order";
import { cancelPendingOrder } from "@/server/order/fulfill-order";
import { getTurnstileSecretKey, isTurnstileEnforced } from "@/server/settings";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { checkOrderRateLimit } from "@/server/security/rate-limit";
import { headers } from "next/headers";

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

  // 限流：Turnstile 关闭时这是唯一的下单频率防线。
  // 不加限制时，脚本可批量创建待支付订单把在售卡密全部锁定（拒绝服务）。
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "-";
  const limited = checkOrderRateLimit(ip, email);
  if (!limited.ok) {
    return { error: limited.message ?? "操作过于频繁，请稍后再试" };
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

/* ===== 过期/关闭订单：重新下单 ===== */

export interface RepurchaseState {
  error?: string;
  ok?: boolean;
  paymentUrl?: string;
  orderNo?: string;
  message?: string;
}

/**
 * 过期订单「重新购买」。
 *
 * 业务规则（方案 A）：过期订单**不恢复**。原因：
 * - 过期时库存已释放（卡密回到 available、manual 库存已回补），
 *   原地恢复需要重新预留，且要与旧交易的可能回调竞争；
 * - 旧通道的收银台地址虽已失效，但延迟回调仍可能到达，
 *   恢复成 pending 会让「旧交易到账」变成合法入账路径，复杂且易错。
 * 因此改为**创建一笔新订单**：语义清晰，库存与支付都走既有安全路径。
 *
 * 需要双因子（订单号 + 邮箱）确认归属，避免凭订单号替他人下单。
 */
export async function repurchaseOrderAction(
  _prev: RepurchaseState | null,
  formData: FormData
): Promise<RepurchaseState> {
  const orderNo = String(formData.get("orderNo") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!orderNo || !email) {
    return { error: "请填写订单号与下单邮箱" };
  }

  // 双因子确认归属（lookupOrder 会顺带把超时订单惰性置为 expired）
  const view = lookupOrder(orderNo, email);
  if (!view) return { error: "订单号与邮箱不匹配" };

  if (view.status === "completed" || view.status === "paid" || view.status === "delivering") {
    return { error: "该订单已支付，无需重新购买" };
  }
  if (view.status === "pending") {
    return { error: "该订单仍在待支付状态，请直接前往收银台完成支付" };
  }
  // 仅 expired / closed 允许重新购买
  if (!view.productSlug) {
    return { error: "原商品已下架或删除，请返回商品列表重新选择" };
  }

  try {
    // 通过原始订单反查下单参数，创建一笔全新订单
    const fresh = await createOrderForRepurchase(orderNo, email);
    return {
      ok: true,
      orderNo: fresh.orderNo,
      paymentUrl: fresh.paymentUrl,
      message: "已为你创建新订单",
    };
  } catch (err) {
    if (err instanceof OrderError) return { error: err.message };
    console.error("[repurchaseOrderAction]", err);
    return { error: "重新下单失败，请稍后重试或联系客服" };
  }
}
