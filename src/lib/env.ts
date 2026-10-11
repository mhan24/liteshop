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
} as const;

// AUTH_SECRET 的强制校验在运行时进行（lib/session.authSecret），避免构建期收集页面数据时误报
