import { z } from "zod";
import { normalizeAdminPath } from "./admin-path";

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
  ADMIN_PATH: z
    .string()
    .regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*\/?)?$/i, "ADMIN_PATH 需为 / 开头的本机路径，不能含空路径段")
    .refine((v) => !/^\/(api|_next)(\/|$)/i.test(v), "ADMIN_PATH 不能占用 /api 或 /_next")
    .default("/admin")
    .transform(normalizeAdminPath),

  DATABASE_URL: z
    .string()
    .default("postgres://liteshop:liteshop@localhost:54329/liteshop"),

  CRON_SECRET: z.string().default(""),
  PAYMENT_DRIVER: z.enum(["auto", "mock"]).default("auto"),
})
  // mock 网关的「确认支付」对任何人开放：生产环境启用等于免费发卡，启动即失败
  .refine((e) => !(e.NODE_ENV === "production" && e.PAYMENT_DRIVER === "mock"), {
    message: "生产环境禁止 PAYMENT_DRIVER=mock",
    path: ["PAYMENT_DRIVER"],
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`环境变量校验失败：\n${issues}`);
  }
  return parsed.data;
}

export const env = parseEnv();
