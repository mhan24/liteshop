import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** 执行 drizzle 版本化迁移（deploy 与测试前运行） */
async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://liteshop:liteshop@localhost:54329/liteshop";
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[migrate] 完成");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] 失败:", err);
  process.exit(1);
});
