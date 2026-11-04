import { minorToNumber } from "@/lib/money";

/**
 * 支付适配器接口。站点只接一个网关（LitePay），mock 仅用于开发与测试。
 *
 * 结果分类（决定上层能否安全释放库存）：
 * - created ：网关明确返回交易
 * - rejected：网关明确拒绝本次请求（未建单）→ 可安全关单释放库存
 * - unknown ：结果未知（超时/5xx/响应损坏）→ 网关可能已建单，必须保留订单进入对账
 */

export type GatewayType = "litepay" | "mock";

export interface GatewayRuntime {
  type: GatewayType;
  /** 网关地址（仅 origin）；mock 为 null */
  apiBase: string | null;
  /** 接口令牌；mock 为固定测试令牌 */
  token: string | null;
  /** 收银台可选币种限制（如 "USDT,USDC"）；空 = 网关默认 */
  currencies: string | null;
  /** 订单有效期（秒） */
  timeoutSeconds: number;
  /** 是否允许买家在收银台重选平台与币种 */
  reselect: boolean;
}

export interface CreatePaymentInput {
  /** 商户订单号（发给网关的 order_id） */
  orderNo: string;
  amountCents: number;
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
  /** 网关回报的法币金额（USD，原样字符串/数字） */
  amount: string | number | null;
  /** 网关回报的加密货币实付数量 */
  actualAmount: string | null;
  /** LitePay 只发成功通知（2）；1/3 属于其它 BEpusdt 网关的语义，这里照样保留 */
  status: number;
}

export interface NotifyVerification {
  ok: boolean;
  payload?: NotifyPayload;
  error?: string;
}

export interface PaymentAdapter {
  readonly type: GatewayType;
  createPayment(gateway: GatewayRuntime, input: CreatePaymentInput): Promise<CreateOutcome>;
  verifyNotify(gateway: GatewayRuntime, rawBody: string): NotifyVerification;
  /** 商户侧主动关单时通知网关撤销未到账交易（best-effort） */
  cancelPayment?(gateway: GatewayRuntime, providerRef: string): Promise<{ ok: boolean; message: string }>;
}

export function fiatAmountForGateway(amountCents: number): number {
  return minorToNumber(amountCents);
}
