import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, products } from "@/db/schema";
import { getSiteUrl } from "@/server/settings";
import { checkActiveOrderCapacity } from "@/server/security/rate-limit";
import {
  insertOrderWithRetry,
  OrderError,
  type CreateOrderResult,
} from "@/server/order/create-order";
import { allocateUniquePayable, fiatToPayableMinor, formatPayable } from "./amount";
import { findEnabledExchange, loadExchangeCredentials, type ExchangeAsset } from "./channel";

/**
 * 交易所收款的下单入口。
 *
 * 与网关下班的差别：
 * - **不调用任何 API**，不产生 paymentUrl / trade_id（交易号要到账时才有）
 * - 只做一件事：分配一个**唯一应付金额**，并连同有效期一起写进订单
 * - 买家按页面上给出的「收款账户 + 精确金额」内部转账，到账由扫描器识别
 *
 * 应付金额存为 "<金额> <币种>"（如 "5.03 USDT"），既保留可读性，
 * 又能与交易所流水逐字比对。
 *
 * 唯一性：同一收款账户 + 币种下，已被**未结束**订单占用的金额会被跳过，
 * 分配在同一个 IMMEDIATE 事务里完成 —— 修掉了 HashPay「查询→写入非原子」
 * 的并发竞态（其 uniqueAmount 存在两个并发订单算出同额的可能）。
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 交易所转账的默认有效期（分钟）—— 需覆盖内部转账的处理时间 */
export const EXCHANGE_PAYMENT_WINDOW_MINUTES = 30;

export interface CreateExchangeOrderInput {
  slug: string;
  email: string;
  quantity: number;
  note?: string;
}

/** 当前已占用（未结束）的交易所应付金额集合 —— 分配唯一金额的依据 */
function usedPayables(asset: ExchangeAsset): Set<string> {
  const rows = db
    .select({ expected: orders.expectedActualAmount })
    .from(orders)
    .where(
      and(
        sql`${orders.expectedActualAmount} is not null`,
        sql`lower(${orders.expectedActualAmount}) like ${"%" + asset.toLowerCase() + "%"}`,
        // 仅"未结束"的订单参与占用：completed/closed/expired 不再占用金额
        sql`${orders.status} not in ('completed', 'closed', 'expired')`
      )
    )
    .all();
  const set = new Set<string>();
  for (const r of rows) {
    if (!r.expected) continue;
    const amt = String(r.expected).trim().split(/\s+/)[0];
    if (amt) set.add(amt);
  }
  return set;
}

/**
 * 创建一笔交易所收款订单。
 * 未配置可用的交易所渠道时抛出 ORDER_NOT_FOUND（前端据此提示不可用）。
 */
export async function createExchangeOrder(
  input: CreateExchangeOrderInput
): Promise<CreateOrderResult & { payableAmount: string; asset: ExchangeAsset; accountId: string }> {
  const email = input.email.trim();
  const note = input.note?.trim() ?? "";
  const quantity = Math.trunc(input.quantity);

  if (!EMAIL_RE.test(email) || email.length > 200) {
    throw new OrderError("INVALID_INPUT", "请输入有效的联系邮箱");
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new OrderError("INVALID_INPUT", "购买数量需在 1-99 之间");
  }

  const provider = findEnabledExchange();
  if (!provider) {
    throw new OrderError("NO_PAYMENT_CHANNEL", "交易所收款渠道未启用或未配置完整");
  }
  const loaded = loadExchangeCredentials(provider);
  if (!loaded) {
    throw new OrderError("NO_PAYMENT_CHANNEL", "交易所凭据不可用，请联系客服");
  }
  const { asset, rate } = loaded;

  const siteUrl = getSiteUrl();

  // 商品快照与占库建单 + 唯一金额分配，在同一个 IMMEDIATE 事务内完成，
  // 杜绝并发下算出重复金额。
  const created = db.transaction(
    (tx) => {
      const capacity = checkActiveOrderCapacity(tx);
      if (!capacity.ok) throw new OrderError("ORDER_CAPACITY", capacity.message ?? "当前订单数量已达上限");
      const product = tx
        .select()
        .from(products)
        .where(and(eq(products.slug, input.slug), eq(products.status, "on")))
        .get();
      if (!product) throw new OrderError("PRODUCT_NOT_FOUND", "商品不存在或已下架");

      const orderNo = insertOrderWithRetry(tx, product, { email, note, quantity });
      const totalCents = BigInt(product.priceCents) * BigInt(quantity);

      // 汇率换算 → 向上取整 → 去重
      const base = fiatToPayableMinor(totalCents, product.currency, rate);
      const used = usedPayables(asset);
      const unique = allocateUniquePayable(base, used);
      if (unique === null) {
        // 极端情况下（如促销把大量订单挤进同一分位）无唯一金额可用 → 拒绝建单
        throw new OrderError("ORDER_CAPACITY", "当前支付通道繁忙，请稍后再试或更换支付方式");
      }
      const payable = formatPayable(unique);
      const expiresAt = new Date(Date.now() + EXCHANGE_PAYMENT_WINDOW_MINUTES * 60_000);

      // 把应付金额与有效期写入订单（格式 "<金额> <币种>"）
      tx.update(orders)
        .set({
          expectedActualAmount: `${payable} ${asset}`,
          expirationTime: expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(orders.orderNo, orderNo))
        .run();

      return { orderNo, totalCents, payable, expiresAt, currency: product.currency, accountId: loaded.cred.accountId };
    },
    { behavior: "immediate" }
  );

  return {
    orderNo: created.orderNo,
    // 交易所收款没有收银台地址：引导买家回到订单页看转账指引
    paymentUrl: `${siteUrl}/pay/pending?order_no=${encodeURIComponent(created.orderNo)}`,
    totalCents: created.totalCents,
    currency: created.currency,
    expiresAt: created.expiresAt,
    provider: `exchange:${provider}`,
    payableAmount: created.payable,
    asset,
    accountId: created.accountId,
  };
}