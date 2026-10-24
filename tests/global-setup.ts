import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { paymentChannels } from "../src/db/schema";

/** 测试前置：对测试库执行迁移（幂等）+ 预置 mock 支付渠道 */
export async function setup(): Promise<void> {
  const pool = new Pool({
    connectionString: "postgres://postgres:liteshop-test@localhost:54330/liteshop_test",
    max: 1,
  });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./drizzle" });
    await db
      .insert(paymentChannels)
      .values({ key: "mock", type: "mock", displayName: "模拟支付（开发）", enabled: true })
      .onConflictDoNothing();
  } finally {
    await pool.end();
  }
}

export async function teardown(): Promise<void> {
  void 0;
}
