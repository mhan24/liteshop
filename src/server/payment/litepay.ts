import { bepusdtProvider } from "./bepusdt";
import type {
  CreatePaymentInput,
  CreatedPayment,
  NotifyVerification,
  PaymentProvider,
} from "./index";

/**
 * litepay 渠道（pay.9527.tr，LitePay 收款网关）。
 *
 * 2026-10 重构：LitePay 下线了原生商户 API（POST /api/v1/orders，HMAC 头部签名），
 * 改为提供 **BEpusdt 兼容接口**（收银台模式）：
 *   - 下单 POST {api_base}/api/v1/order/create-order（MD5 签名，同 bepusdt 协议）
 *   - 商户关单 POST {api_base}/api/v1/order/cancel-transaction
 *   - 回调 POST JSON（status 1/2/3，商户应答 2xx + 正文 success/ok）
 * 收银台由网关托管：买家先选 Binance / OKX，再选 USDT / USDC，
 * 按页面精确金额发起交易所站内转账，到账后网关回调本站自动发货。
 *
 * 因此协议实现与 bepusdt 渠道**共享同一份代码**（同签名/同报文/同状态语义），
 * 本渠道只做两件事：
 *   1. 渠道标识保持 "litepay"（回调路由 /api/pay/notify/litepay、
 *      支付尝试归属、管理台配置行都不变）
 *   2. 配置键与 bepusdt 相同：api_base / token / currencies / reselect / timeout_seconds
 *      （旧版 merchant_id / secret / provider / coin / network 已随原生 API 一并废弃）
 *
 * 旧版「本站展示交易所 ID」的 /pay/address 页面仅服务历史订单
 * （parseLitepayPaymentTarget 解析落库的旧网关响应快照）。
 */

/** 本站历史收款信息页地址（旧版订单仍在使用） */
export const LITEPAY_ADDRESS_PATH = "/pay/address";

/** 收款信息（供历史订单的 /pay/address 页面渲染；来源为落库的旧网关响应快照） */
export interface LitepayPaymentTarget {
  address: string;
  method?: string;
  provider?: string;
  memo: string;
  amount: string | null;
  currency: string | null;
  network: string | null;
  expiresAtMs: number | null;
}

interface LegacyLitepayOrderData {
  order_no?: string;
  provider?: string;
  payment_method?: string;
  currency?: string;
  network?: string;
  amount?: string;
  pay_address?: string;
  pay_id?: string;
  pay_memo?: string;
  expire_time?: number;
}

/**
 * 从旧版支付尝试落库的原始响应中提取收款信息（纯函数，便于单测）。
 * 非旧版 litepay 结构或缺少 ID/地址时返回 null。
 */
export function parseLitepayPaymentTarget(raw: unknown): LitepayPaymentTarget | null {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const data = parsed as LegacyLitepayOrderData;
  const address =
    (typeof data.pay_id === "string" ? data.pay_id.trim() : "") ||
    (typeof data.pay_address === "string" ? data.pay_address.trim() : "");
  if (!address) return null;
  return {
    address,
    ...(typeof data.payment_method === "string" ? { method: data.payment_method } : {}),
    ...(typeof data.provider === "string" ? { provider: data.provider } : {}),
    memo: typeof data.pay_memo === "string" ? data.pay_memo.trim() : "",
    amount: typeof data.amount === "string" && data.amount !== "" ? data.amount : null,
    currency: typeof data.currency === "string" && data.currency !== "" ? data.currency : null,
    network: typeof data.network === "string" && data.network !== "" ? data.network : null,
    expiresAtMs:
      typeof data.expire_time === "number" && Number.isFinite(data.expire_time)
        ? data.expire_time
        : null,
  };
}

export function litepayProvider(rawConfig: Record<string, unknown>): PaymentProvider {
  const inner = bepusdtProvider(rawConfig);

  return {
    name: "litepay",

    async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
      const created = await inner.createPayment(input);
      // 归属校验按「尝试.provider === 回调.payload.provider」判定，
      // 快照与回调都必须携带 litepay 渠道名
      return { ...created, provider: "litepay" };
    },

    verifyNotify(rawBody: string, headers?: Headers): NotifyVerification {
      const verification = inner.verifyNotify(rawBody, headers);
      if (verification.ok && verification.payload) {
        return {
          ok: true,
          payload: { ...verification.payload, provider: "litepay" },
        };
      }
      return verification;
    },

    cancelPayment: (tradeId) => inner.cancelPayment!(tradeId),
  };
}
