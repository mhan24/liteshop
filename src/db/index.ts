import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * PostgreSQL 连接（单例 Pool）。
 *
 * - 单实例部署，Pool 上限收敛，避免打满数据库连接
 * - 支付确认/卡密分配等关键路径全部走 db.transaction（读已提交 + 显式行锁）
 */

const globalForDb = globalThis as unknown as { __liteshopPool?: Pool };

export const pool =
  globalForDb.__liteshopPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://liteshop:liteshop@localhost:54329/liteshop",
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__liteshopPool = pool;

export type Database = ReturnType<typeof drizzle<typeof schema>>;
export const db = drizzle(pool, { schema });
export { schema };
