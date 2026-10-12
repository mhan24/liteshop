import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { envConfig, assertProductionSafety } from "@/lib/env";

/**
 * SQLite 单连接（better-sqlite3 同步 API）：
 * - 单写者模型 + IMMEDIATE 事务是并发安全的基础（PLAN §6-①）
 * - WAL 提升读写并发；busy_timeout 防止锁竞争报错
 */
function openDb(): Database.Database {
  const dbPath =
    envConfig.dbPath ?? path.join(envConfig.dataDir, "liteshop.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  return db;
}

function runMigrations(sqlite: Database.Database) {
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (!fs.existsSync(path.join(migrationsFolder, "meta"))) return;
  migrate(drizzle(sqlite, { schema }), { migrationsFolder });
}

/** 首次启动种子（幂等）：站点默认设置 + bepusdt 渠道占位 */
function ensureSeed(sqlite: Database.Database) {
  sqlite.exec(`
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('site_name', 'liteshop'),
      ('site_url', ''),
      ('currency', 'USD');
    INSERT OR IGNORE INTO payment_configs (provider, enabled, config_json) VALUES
      ('bepusdt', 0, '{}');
  `);
}

function createDb() {
  // 生产安全自检：配置错误立即失败，避免带病上线。
  //
  // 但**构建期**（next build 收集页面数据）会以 NODE_ENV=production 求值本模块，
  // 此时并无运行时配置——若在此抛错，构建就必须依赖真实 .env 才能通过，
  // 那等于强迫把密钥放进构建上下文（曾因此让生产镜像构建依赖泄露的 .env）。
  // 因此构建期跳过自检，真正的校验在运行时首次访问数据库时执行。
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    assertProductionSafety();
  }
  const sqlite = openDb();
  runMigrations(sqlite);
  ensureSeed(sqlite);
  return drizzle(sqlite, { schema });
}

type Db = ReturnType<typeof createDb>;

/** dev 热重载与多模块实例间共享同一连接 */
const globalForDb = globalThis as unknown as { __liteshopDb?: Db };

export const db: Db = globalForDb.__liteshopDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.__liteshopDb = db;

export { schema };
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
