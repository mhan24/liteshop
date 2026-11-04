import { env } from "@/lib/env";
import type { GatewayRuntime, GatewayType, PaymentAdapter } from "./types";
import { getLitepayConfig, isLitepayReady, litepayAdapter, toGatewayRuntime } from "./litepay";
import { MOCK_TOKEN, mockAdapter } from "./mock";

/**
 * 单一支付网关：LitePay 收银台。
 *
 * 站点不再维护多渠道表：网关地址、接口令牌、有效期与币种限制都在后台
 * 「设置 · 支付网关」里，回调固定走 /api/webhooks/litepay。
 * PAYMENT_DRIVER=mock 时改用进程内模拟网关（开发与自动化测试）。
 */

export const MOCK_GATEWAY: GatewayRuntime = {
  type: "mock",
  apiBase: null,
  token: MOCK_TOKEN,
  currencies: null,
  timeoutSeconds: 1800,
  reselect: false,
};

export interface ActiveGateway {
  type: GatewayType;
  runtime: GatewayRuntime;
}

/** 当前生效的网关；未配置（或已停用）时返回 null，下单会被拒绝 */
export async function getActiveGateway(): Promise<ActiveGateway | null> {
  if (env.PAYMENT_DRIVER === "mock") {
    return { type: "mock", runtime: MOCK_GATEWAY };
  }
  const cfg = await getLitepayConfig();
  if (!isLitepayReady(cfg)) return null;
  return { type: "litepay", runtime: toGatewayRuntime(cfg) };
}

/** 按标识取网关运行时（回调验签、关单撤销用） */
export async function getGatewayByType(type: GatewayType): Promise<GatewayRuntime> {
  if (type === "mock") return MOCK_GATEWAY;
  return toGatewayRuntime(await getLitepayConfig());
}

export function getAdapter(type: GatewayType): PaymentAdapter {
  return type === "mock" ? mockAdapter : litepayAdapter;
}

/** 回调地址（站点对外地址之后的部分） */
export function webhookPath(type: GatewayType): string {
  return type === "mock" ? "/api/webhooks/mock" : "/api/webhooks/litepay";
}

/** 后台展示用的网关状态 */
export interface GatewayStatus {
  ready: boolean;
  driver: "auto" | "mock";
  type: GatewayType | null;
  apiBase: string | null;
  hasToken: boolean;
  timeoutSeconds: number;
  currencies: string | null;
  reselect: boolean;
}

export async function getGatewayStatus(): Promise<GatewayStatus> {
  if (env.PAYMENT_DRIVER === "mock") {
    return {
      ready: true,
      driver: "mock",
      type: "mock",
      apiBase: null,
      hasToken: true,
      timeoutSeconds: MOCK_GATEWAY.timeoutSeconds,
      currencies: null,
      reselect: false,
    };
  }
  const cfg = await getLitepayConfig();
  return {
    ready: isLitepayReady(cfg),
    driver: "auto",
    type: cfg.apiBase || cfg.hasToken ? "litepay" : null,
    apiBase: cfg.apiBase,
    hasToken: cfg.hasToken,
    timeoutSeconds: cfg.timeoutSeconds,
    currencies: cfg.currencies,
    reselect: cfg.reselect,
  };
}
