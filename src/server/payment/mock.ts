import { randomBytes } from "node:crypto";
import { epusdtSign, epusdtVerify } from "@/lib/signature";
import type {
  CreatePaymentInput,
  CreatedPayment,
  NotifyPayload,
  NotifyStatus,
  NotifyVerification,
  PaymentProvider,
} from "./index";

/**
 * 本地模拟收单（PAYMENT_DRIVER=mock）：与 bepusdt 相同的回调报文结构与签名算法，
 * 用于无真实网关时跑通「下单 → 支付 → 回调 → 发货」全链路（PLAN §10）。
 */

const DEFAULT_TOKEN = "mock-token";

function token(): string {
  return (process.env.MOCK_PAYMENT_TOKEN || DEFAULT_TOKEN);
}

export function mockProvider(): PaymentProvider {
  return {
    name: "mock",

    async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
      const tradeId = `mock_${randomBytes(8).toString("hex")}`;
      const timeout = input.timeoutSeconds ?? 600;
      return {
        provider: "mock",
        tradeId,
        paymentUrl: `/pay/mock?order_no=${encodeURIComponent(input.orderNo)}`,
        expectedActualAmount: null,
        expirationTime: new Date(Date.now() + timeout * 1000),
        raw: { tradeId, timeout },
      };
    },

    verifyNotify(rawBody: string): NotifyVerification {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return { ok: false, error: "JSON 解析失败" };
      }
      if (!epusdtVerify(body, token())) {
        return { ok: false, error: "签名校验失败" };
      }
      const status = Number(body["status"]);
      if (![1, 2, 3].includes(status)) {
        return { ok: false, error: `非法 status: ${String(body["status"])}` };
      }
      const payload: NotifyPayload = {
        provider: "mock",
        orderNo: String(body["order_id"] ?? ""),
        tradeId: body["trade_id"] != null ? String(body["trade_id"]) : null,
        amount: (body["amount"] ?? null) as string | number | null,
        actualAmount: body["actual_amount"] != null ? String(body["actual_amount"]) : null,
        status: status as NotifyStatus,
        blockTxnId: body["block_transaction_id"] != null ? String(body["block_transaction_id"]) : null,
      };
      if (!payload.orderNo) return { ok: false, error: "缺少 order_id" };
      return { ok: true, payload };
    },
  };
}

/** mock 收银台页构造带签名的回调报文（服务端 action 调用） */
export function buildMockNotifyBody(params: {
  orderNo: string;
  tradeId: string;
  amountCents: bigint;
  status: NotifyStatus;
}): string {
  const body: Record<string, unknown> = {
    trade_id: params.tradeId,
    order_id: params.orderNo,
    amount: Number(params.amountCents) / 100,
    actual_amount: (Number(params.amountCents) / 100).toFixed(6),
    token: "0xmock",
    block_transaction_id: `0xmock_${randomBytes(8).toString("hex")}`,
    status: params.status,
  };
  return JSON.stringify({ ...body, signature: epusdtSign(body, token()) });
}
