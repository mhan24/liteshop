import { isValidOrderNo } from "@/lib/order-no";

/**
 * 本地订单缓存（浏览器 localStorage）。
 *
 * 目的：方便买家在同一浏览器里**重新支付 / 取消 / 查询**自己最近的订单，
 * 不用每次都翻聊天记录或邮件找订单号。
 *
 * 安全边界（重要）：
 * 本缓存**只是输入便利**，绝不构成授权凭据。
 *   - 取消订单 / 查询详情 / 重新支付，服务端一律仍按「订单号 + 邮箱」双因子校验；
 *   - 缓存条目不含邮箱以外的任何敏感信息，也不含交付内容；
 *   - 缓存被篡改最多导致「少填一个订单号」，无法越权访问他人订单。
 * 因此可以放心存 localStorage（不涉及 HttpOnly，也不需要）。
 *
 * 数据最小化：只存订单号、邮箱、商品名、金额与时间，不存卡密 / 交付内容，
 * 也不存支付地址，避免在共享设备上留下可复用的付款凭据。
 */

const STORAGE_KEY = "liteshop.orders.v1";
/** 最多保留条数：超出丢弃最旧的，避免无上限增长 */
const MAX_ENTRIES = 20;

export interface CachedOrder {
  orderNo: string;
  email: string;
  productName: string;
  /** 展示用金额（已格式化字符串） */
  total: string;
  /** 下单时间（ISO） */
  createdAt: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 读取缓存；任何异常或格式不符都返回空列表。
 * 不抛错：localStorage 在隐私模式/配额耗尽时可能抛异常。
 */
export function readCachedOrders(): CachedOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function isValidEntry(v: unknown): v is CachedOrder {
  if (!isRecord(v)) return false;
  // 订单号必须通过格式与校验位验证（防止缓存被手改成任意字符串）
  if (typeof v.orderNo !== "string" || !isValidOrderNo(v.orderNo)) return false;
  if (typeof v.email !== "string" || !v.email.includes("@")) return false;
  return (
    typeof v.productName === "string" &&
    typeof v.total === "string" &&
    typeof v.createdAt === "string"
  );
}

/**
 * 写入/更新一条缓存（按订单号去重，置顶）。
 * 已存在的订单只更新可变字段，保持原有创建时间。
 */
export function rememberOrder(entry: CachedOrder): void {
  if (typeof window === "undefined") return;
  if (!isValidEntry(entry)) return;
  try {
    const rest = readCachedOrders().filter((o) => o.orderNo !== entry.orderNo);
    const next = [entry, ...rest].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 配额满或隐私模式：静默忽略，不影响下单主流程
  }
}

/** 按订单号移除（订单已完成交付后调用，减少残留） */
export function forgetOrder(orderNo: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = readCachedOrders().filter((o) => o.orderNo !== orderNo);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 忽略
  }
}

/** 清空全部缓存（供"清除本地记录"使用） */
export function clearCachedOrders(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}