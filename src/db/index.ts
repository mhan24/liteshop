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

/**
 * 是否处于「构建期」。
 *
 * next build 会以 NODE_ENV=production 求值本模块来收集页面数据，
 * 但构建**不应该**打开数据库：它只为类型检查与打包，
 * 开库会带来三个问题：
 *   1) 并发 worker 各自跑迁移 → 互相冲突（曾导致 CI 构建失败）
 *   2) 构建被迫依赖磁盘上的 data/ 目录或真实密钥
 *   3) 在只读文件系统（如某些 CI 沙箱）上直接失败
 * 因此构建期返回一个惰性代理：只有运行期真正执行查询时才建立连接。
 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function createDb() {
  // 生产安全自检：配置错误立即失败，避免带病上线。
  // 构建期无运行时配置，跳过（真正的校验在运行期首次连接时执行）。
  if (!isBuildPhase()) {
    assertProductionSafety();
  }
  const sqlite = openDb();
  runMigrations(sqlite);
  ensureSeed(sqlite);
  return drizzle(sqlite, { schema });
}

/**
 * 构建期占位实现：任何属性访问/调用都抛错并提示这是构建期。
 * 页面数据收集不会真的查询数据库（路由均为 dynamic），
 * 因此构建能正常完成，而一旦被误用会立刻暴露。
 */
function createBuildPhaseStub() {
  const fail = (): never => {
    throw new Error(
      "构建期不应访问数据库。请确认该页面/路由标记为 dynamic，或改到运行期读取。"
    );
  };
  return new Proxy({}, {
    get: () => fail,
    apply: () => fail,
  }) as unknown as Db;
}

type Db = ReturnType<typeof createDb>;

/**
 * 进程内单例。
 *
 * 必须在**所有环境**缓存，而不只是 dev：
 * 生产构建（next build）会并发多个 worker 收集页面数据，每个 worker 都会
 * 求值本模块。若不缓存，每个 worker 都会 openDb + runMigrations，
 * 并发迁移同一个库会互相冲突（曾导致 CI 报 `table admin_logs already exists`，
 * 使无密钥 Docker 构建失败）。运行期同理：避免重复迁移带来的写竞争。
 */
const globalForDb = globalThis as unknown as { __liteshopDb?: Db };

export const db: Db =
  globalForDb.__liteshopDb ?? (isBuildPhase() ? createBuildPhaseStub() : createDb());
if (!isBuildPhase()) globalForDb.__liteshopDb = db;

export { schema };
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
