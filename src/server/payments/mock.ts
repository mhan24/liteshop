import { hmacHex, parseJsonObject, safeEqualHex, sha256Hex } from "@/lib/epusdt";
import { minorToNumber } from "@/lib/money";
import type {
  ChannelRuntime,
  CreateOutcome,
  CreatePaymentInput,
  NotifyVerification,
  PaymentAdapter,
} from "./types";

/**
 * 本地模拟支付（仅 PAYMENT_DRIVER=mock 时启用；生产禁用）。
 *
 * 收银台 = 本站 /pay/mock 页面；回调由页面/测试用 HMAC-SHA256 签名构造，
 * 完整跑通「下单 → 回调 → 原子发卡」链路，无需真实网关。
 */

export const MOCK_TOKEN = "mock-token";

export function buildMockNotifyBody(input: {
  orderNo: string;
  providerRef: string;
  amountMinor: number;
  currency: string;
  status: 1 | 2 | 3;
  fiatAmount: number;
}): string {
  const body: Record<string, unknown> = {
    trade_id: input.providerRef,
    order_id: input.orderNo,
    amount: input.fiatAmount,
    actual_amount: input.fiatAmount,
    token: "mock",
    status: input.status,
  };
  const signature = hmacHex(MOCK_TOKEN, sha256Hex(JSON.stringify(body)));
  return JSON.stringify({ ...body, signature });
}

export const mockAdapter: PaymentAdapter = {
  type: "mock",

  async createPayment(_channel: ChannelRuntime, input: CreatePaymentInput): Promise<CreateOutcome> {
    const providerRef = `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const url = `/pay/mock?order_no=${encodeURIComponent(input.orderNo)}&ref=${encodeURIComponent(providerRef)}`;
    return {
      kind: "created",
      payment: {
        providerRef,
        paymentUrl: url,
        // 与回调 actual_amount 同口径（法币数值），保证快照核对一致
        expectedAmount: String(minorToNumber(input.amountMinor, input.currency)),
        expiresAt: new Date(Date.now() + 30 * 60_000),
        raw: { mock: true },
      },
    };
  },

  verifyNotify(channel: ChannelRuntime, rawBody: string): NotifyVerification {
    const parsed = parseJsonObject(rawBody);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const body = parsed.value;
    const { signature, ...rest } = body as Record<string, unknown> & { signature?: unknown };
    const expected = hmacHex(MOCK_TOKEN, sha256Hex(JSON.stringify(rest)));
    if (typeof signature !== "string" || !safeEqualHex(expected, signature)) {
      return { ok: false, error: "签名校验失败" };
    }
    const status = Number(rest["status"]);
    if (![1, 2, 3].includes(status)) return { ok: false, error: "非法 status" };
    const orderNo = String(rest["order_id"] ?? "");
    const providerRef = String(rest["trade_id"] ?? "");
    if (!orderNo || !providerRef) return { ok: false, error: "缺少 order_id / trade_id" };
    return {
      ok: true,
      payload: {
        providerRef,
        orderNo,
        amount: (rest["amount"] ?? null) as string | number | null,
        actualAmount: rest["actual_amount"] != null ? String(rest["actual_amount"]) : null,
        status: status as 1 | 2 | 3,
      },
    };
  },
};
