import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** 容器启动前置：执行 drizzle 版本化迁移（幂等，plain JS 供 standalone 运行时使用） */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] 缺少 DATABASE_URL");
  process.exit(1);
}
const pool = new Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("[migrate] 完成");
} finally {
  await pool.end();
}
