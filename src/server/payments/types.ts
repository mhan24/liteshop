import { minorToNumber } from "@/lib/money";

/**
 * 统一支付适配器接口。
 *
 * 结果分类（决定上层能否安全释放库存）：
 * - created ：网关明确返回交易
 * - rejected：网关明确拒绝本次请求（未建单）→ 可安全关单释放库存
 * - unknown ：结果未知（超时/5xx/响应损坏）→ 网关可能已建单，必须保留订单进入对账
 */

export interface ChannelRuntime {
  id: number;
  key: string;
  type: "epusdt" | "mock";
  displayName: string;
  apiBase: string | null;
  token: string | null;
  currencies: string | null;
  timeoutSeconds: number;
  reselect: boolean;
}

export interface CreatePaymentInput {
  /** 商户订单号（发给网关的 order_id） */
  orderNo: string;
  amountMinor: number;
  currency: string;
  subject: string;
  notifyUrl: string;
  redirectUrl: string;
}

export interface CreatedPayment {
  providerRef: string | null;
  paymentUrl: string | null;
  expectedAmount: string | null;
  expiresAt: Date | null;
  raw: unknown;
}

export type CreateOutcome =
  | { kind: "created"; payment: CreatedPayment }
  | { kind: "rejected"; message: string }
  | { kind: "unknown"; message: string };

export interface NotifyPayload {
  providerRef: string;
  orderNo: string;
  /** 网关回报的法币金额（原样字符串/数字，换算在履约层做） */
  amount: string | number | null;
  actualAmount: string | null;
  status: 1 | 2 | 3;
}

export interface NotifyVerification {
  ok: boolean;
  payload?: NotifyPayload;
  error?: string;
}

export interface PaymentAdapter {
  readonly type: ChannelRuntime["type"];
  createPayment(channel: ChannelRuntime, input: CreatePaymentInput): Promise<CreateOutcome>;
  verifyNotify(channel: ChannelRuntime, rawBody: string): NotifyVerification;
  /** 商户侧主动关单时通知网关撤销未到账交易（best-effort） */
  cancelPayment?(channel: ChannelRuntime, providerRef: string): Promise<{ ok: boolean; message: string }>;
}

export function fiatAmountForGateway(amountMinor: number, currency: string): number {
  return minorToNumber(amountMinor, currency);
}
