/* 在线一致性备份：SQLite VACUUM INTO（免停机，PLAN §6-④） */
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const dbPath = process.env.DATABASE_PATH ?? path.join(dataDir, "liteshop.db");
const outDir = process.env.BACKUP_DIR ?? path.join(dataDir, "backups");
fs.mkdirSync(outDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const target = path.join(outDir, `liteshop-${stamp}.db`);

const src = new Database(dbPath, { readonly: true });
src.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
src.close();

console.log(`备份完成: ${target}`);
