import { z } from "zod";

/**
 * 环境变量（启动时一次性解析，非法直接失败——配置错误宁可启动报错，
 * 也不要运行到支付环节才发现）。
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  SITE_URL: z.string().url().default("http://localhost:3000"),

  AUTH_SECRET: z.string().min(32, "AUTH_SECRET 至少 32 字符（openssl rand -hex 32）"),
  ADMIN_USER: z.string().min(1).default("admin"),
  ADMIN_PASSWORD_HASH: z.string().min(1).default(""),
  ADMIN_PATH: z.string().regex(/^\/[a-z0-9-/]*$/i, "ADMIN_PATH 需为 / 开头路径").default("/admin"),

  DATABASE_URL: z
    .string()
    .default("postgres://liteshop:liteshop@localhost:54329/liteshop"),

  CRON_SECRET: z.string().default(""),
  PAYMENT_DRIVER: z.enum(["auto", "mock"]).default("auto"),
});

export type Env = z.infer<typeof schema>;

function parseEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`环境变量校验失败：\n${issues}`);
  }
  return parsed.data;
}

export const env = parseEnv();

/** 站点对外地址（去掉尾部斜杠与 query/hash） */
export function siteUrl(): string {
  const u = new URL(env.SITE_URL);
  u.search = "";
  u.hash = "";
  return u.toString().replace(/\/+$/, "");
}
