import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** 测试前置：对测试库执行迁移（幂等） */
export async function setup(): Promise<void> {
  const pool = new Pool({
    connectionString: "postgres://postgres:liteshop-test@localhost:54330/liteshop_test",
    max: 1,
  });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}

export async function teardown(): Promise<void> {
  void 0;
}
