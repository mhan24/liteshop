import path from "node:path";

/** 服务端环境配置。仅在 server 侧引用（含 server service 层），禁止进入 client bundle。 */

function env(key: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v === "" ? undefined : v;
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const envConfig = {
  nodeEnv,
  isProd: nodeEnv === "production",

  /** SQLite 数据目录（Docker 卷挂载点） */
  dataDir: env("DATA_DIR") ?? path.join(process.cwd(), "data"),
  dbPath: env("DATABASE_PATH"), // 未设置则用 dataDir/liteshop.db

  /** 会话签名密钥；生产必须显式提供（openssl rand -hex 32） */
  authSecret: env("AUTH_SECRET") ?? (nodeEnv === "production" ? undefined : "dev-only-insecure-secret"),

  adminUser: env("ADMIN_USER") ?? "admin",
  /** scrypt 格式：scrypt$N$r$p$salt$hash（scripts/hash-password 生成） */
  adminPasswordHash: env("ADMIN_PASSWORD_HASH"),
  /** 开发兜底：未设置 hash 时允许的明文口令（仅 NODE_ENV=development） */
  adminPasswordDev: env("ADMIN_PASSWORD") ?? "admin123",

  /** mock | bepusdt | auto（读 payment_configs 中启用的渠道） */
  paymentDriver: env("PAYMENT_DRIVER") ?? "auto",

  /** 站点对外地址（notify_url / redirect_url 的默认来源，可被 settings.site_url 覆盖） */
  siteUrl: env("SITE_URL") ?? env("BASE_URL") ?? "http://localhost:3000",

  /** 支付驱动为 mock 时注入的演示口令开关 */
  mockPayment: env("PAYMENT_DRIVER") === "mock",

  /**
   * 定时任务（/api/cron/*）专用密钥。
   * 与 AUTH_SECRET 隔离：定时脚本/外部 cron 只需持有该值，
   * 泄露它不会危及管理会话签名。
   */
  cronSecret: env("CRON_SECRET"),
} as const;

/**
 * 生产环境安全自检（启动即失败，避免"配置错误静默上线"）。
 *
 * 背景：mock 渠道的签名令牌有公开默认值，若在生产可达，任何人可伪造
 * "支付成功"回调白嫖发货（历史上确实存在该漏洞）。虽然渠道门控已修复，
 * 这里再做一道纵深防御：生产 + mock 驱动 = 明确拒绝启动。
 */
export function assertProductionSafety(): void {
  if (!envConfig.isProd) return;

  if (envConfig.paymentDriver === "mock") {
    throw new Error(
      "生产环境禁止 PAYMENT_DRIVER=mock：mock 渠道令牌为公开默认值，会导致伪造支付回调。请改为 auto 或 bepusdt。"
    );
  }

  if (!envConfig.authSecret) {
    throw new Error("生产环境必须设置 AUTH_SECRET（openssl rand -hex 32）");
  }

  // cron 端点会写库（关闭超时订单），密钥缺失会导致端点不可用；
  // 这里仅告警而不阻断启动——因为它不影响前台交易链路。
  if (!envConfig.cronSecret) {
    console.warn(
      "[env] 未设置 CRON_SECRET：/api/cron/* 将拒绝所有请求（超时订单仍由惰性清扫兜底）。"
    );
  } else if (envConfig.cronSecret === envConfig.authSecret) {
    console.warn(
      "[env] CRON_SECRET 与 AUTH_SECRET 相同，失去隔离意义；建议改为独立随机值。"
    );
  }

  // mock 若被显式设置令牌也无法改变"渠道可被门控"的事实，故一并提醒
  if (process.env.MOCK_PAYMENT_TOKEN && envConfig.paymentDriver !== "mock") {
    console.warn(
      "[env] 检测到 MOCK_PAYMENT_TOKEN，但当前驱动非 mock；生产环境请移除该变量以避免误解。"
    );
  }
}
