import { afterAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { encryptSecret } from "@/lib/secret-box";

/**
 * 0002_app_config 数据迁移：在独立数据库里先迁到 0001、写入旧 settings 键值，
 * 再执行 0002，核对转换后的 JSON（类型、密文搬运、明文丢弃、非法值剔除）。
 */
const ADMIN_URL = process.env.DATABASE_URL!.replace(/\/[^/]+$/, "/postgres");
const DB = "liteshop_migration_check";
const url = process.env.DATABASE_URL!.replace(/\/[^/]+$/, `/${DB}`);
const work = mkdtempSync(join(tmpdir(), "liteshop-mig-"));

afterAll(async () => {
  rmSync(work, { recursive: true, force: true });
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.end();
});

describe("0002 settings → app_config 迁移", () => {
  it("把旧键值转换成有类型的配置", async () => {
    const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DB}`);
    await admin.end();

    // 只含 0000–0001 的迁移目录
    const partial = join(work, "partial");
    cpSync("./drizzle", partial, { recursive: true });
    const journalPath = join(partial, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    journal.entries = journal.entries.filter((e: { tag: string }) => e.tag < "0002");
    writeFileSync(journalPath, JSON.stringify(journal));

    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      await migrate(drizzle(pool), { migrationsFolder: partial });
      const token = encryptSecret("gw-token");
      const rows: Array<[string, string]> = [
        ["site_name", "我的店"],
        ["site_url", " https://shop.example.com "],
        ["support_url", ""],
        ["card_low_stock_threshold", "0"],
        ["admin_session_version", "7"],
        ["litepay_enabled", "1"],
        ["litepay_api_base", "https://pay.example.com"],
        ["litepay_token_enc", token],
        ["litepay_timeout_seconds", "abc"],
        ["litepay_reselect", "0"],
        ["smtp_enabled", "0"],
        ["smtp_port", "587"],
        ["smtp_secure", "1"],
        ["smtp_pass", "plain-password"],
        ["turnstile_enabled", "1"],
        ["turnstile_secret_key", "plain-secret"],
      ];
      for (const [k, v] of rows) await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2)", [k, v]);

      await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });

      const { rows: out } = await pool.query("SELECT data FROM app_config WHERE id = 1");
      expect(out[0].data).toEqual({
        siteName: "我的店",
        siteUrl: "https://shop.example.com",
        lowStockThreshold: 0,
        adminSessionVersion: 7,
        litepayEnabled: true,
        litepayApiBase: "https://pay.example.com",
        litepayTokenEnc: token,
        litepayReselect: false,
        smtpEnabled: false,
        smtpPort: 587,
        smtpSecure: true,
        turnstileEnabled: true,
      });
      const { rows: tables } = await pool.query("SELECT to_regclass('public.settings') AS t");
      expect(tables[0].t).toBeNull();
    } finally {
      await pool.end();
    }
  });
});
