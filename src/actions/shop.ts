"use server";

import { grantOrderAccess } from "@/server/order/access";
import { clientIpFromHeaders } from "@/server/security/client-ip";
import {
  checkCancelRateLimit,
  checkLookupMissRateLimit,
  checkLookupRateLimit,
} from "@/server/security/rate-limit";
import {
  canRepurchase,
  createOrder,
  createOrderForRepurchase,
  OrderError,
} from "@/server/order/create-order";
import type { CreateOrderResult } from "@/server/order/create-order";
import { lookupOrder, type PublicOrderView } from "@/server/order/query-order";
import { cancelPendingOrder } from "@/server/order/fulfill-order";
import { getTurnstileSecretKey, isTurnstileEnforced } from "@/server/settings";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { checkRepurchaseLimit } from "@/server/security/rate-limit";
import { guardOrderCreation } from "@/server/security/order-guard";


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

  // 统一入口防护（人机验证 + 频率限制）。
  // 注意：**不要**在此之外再做一次 Turnstile 校验——Token 是一次性的，
  // 重复调用 siteverify 会失败，导致开启验证码后所有下单被拒。
  const guard = await guardOrderCreation(formData, email);
  if (!guard.ok) return { error: guard.error };

  try {
    const result: CreateOrderResult = await createOrder({ slug, email, quantity, note });
    await grantOrderAccess(result.orderNo);
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

  // 独立限流：查单是双因子接口，不限流会成为邮箱枚举通道
  const ip = await clientIpFromHeaders();
  const lim = checkLookupRateLimit(ip);
  if (!lim.ok) {
    return { error: lim.message ?? "查询过于频繁，请稍后再试" };
  }

  const order = lookupOrder(orderNo, email);
  if (!order) {
    // 双因子不匹配单独计数：用更紧的预算压制撞库/枚举
    const miss = checkLookupMissRateLimit(ip);
    if (!miss.ok) {
      return { error: miss.message ?? "查询失败次数过多，请稍后再试" };
    }
    return { error: "没有找到匹配的订单，请核对订单号与邮箱" };
  }
  await grantOrderAccess(order.orderNo);
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

  // 独立限流：取消是写操作（会释放库存），需与查单分开预算
  const cancelLim = checkCancelRateLimit(await clientIpFromHeaders());
  if (!cancelLim.ok) {
    return { error: cancelLim.message ?? "操作过于频繁，请稍后再试" };
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

  // 统一入口防护：重新购买同样会真实占用库存，必须与正常下单同等防护，
  // 否则可凭一笔过期订单反复建单刷空库存（历史缺陷）。
  const guard = await guardOrderCreation(formData, email);
  if (!guard.ok) return { error: guard.error };

  // 双因子确认归属（lookupOrder 会顺带把超时订单惰性置为 expired）
  const view = lookupOrder(orderNo, email);
  if (!view) return { error: "订单号与邮箱不匹配" };

  // 同一原订单的独立配额，收敛重购影响面
  const quota = checkRepurchaseLimit(orderNo, guard.ip ?? "-");
  if (!quota.ok) {
    return { error: quota.message ?? "该订单重新购买次数过多，请稍后再试" };
  }

  // 白名单校验（与服务层共用 RE PURCHASE_ALLOWED_STATUSES，避免两处漂移）
  if (!canRepurchase(view.status)) {
    if (view.status === "completed" || view.status === "paid" || view.status === "delivering") {
      return { error: "该订单已支付，无需重新购买" };
    }
    if (view.status === "pending") {
      return { error: "该订单仍在待支付状态，请直接前往收银台完成支付" };
    }
    if (view.status === "reconciling") {
      return { error: "该订单支付状态待核实，请勿重复付款，请联系客服" };
    }
    return { error: `当前状态（${view.statusLabel}）无法重新购买` };
  }
  if (view.paidAt !== null) {
    return { error: "该订单已付款，如需帮助请联系客服" };
  }
  if (!view.productSlug) {
    return { error: "原商品已下架或删除，请返回商品列表重新选择" };
  }

  try {
    // 通过原始订单反查下单参数，创建一笔全新订单
    const fresh = await createOrderForRepurchase(orderNo, email);
    await grantOrderAccess(fresh.orderNo);
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
