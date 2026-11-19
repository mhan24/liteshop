import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { encryptPlaintextSecrets } from "./encrypt-secrets.mjs";

/** 容器启动前置：drizzle 版本化迁移 + 凭据加密数据迁移（均幂等，plain JS 供 standalone 运行时使用） */
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] 缺少 DATABASE_URL");
  process.exit(1);
}
const pool = new Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  const encrypted = await encryptPlaintextSecrets(pool, process.env.AUTH_SECRET);
  if (encrypted.length) console.log(`[migrate] 已加密明文凭据: ${encrypted.join(", ")}`);
  console.log("[migrate] 完成");
} finally {
  await pool.end();
}
