import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { encryptSecret } from "@/lib/secret-box";
import { getConfig, getSmtpConfig, invalidateConfig, isTurnstileEnforced, updateConfig } from "@/server/settings";
import { resetDb } from "../helpers";

/** 有类型的站点配置：默认值、逐字段容错、并发自增、缓存失效、凭据只认密文 */
describe("站点配置（app_config）", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("空库返回全部默认值（回归：旧实现 Number(null) === 0 让默认值失效）", async () => {
    const c = await getConfig();
    expect(c.lowStockThreshold).toBe(5);
    expect(c.adminSessionVersion).toBe(1);
    expect(c.litepayReselect).toBe(true);
    expect(c.smtpPort).toBe(465);
  });

  it("单个字段格式不对只回落该字段默认值，不影响其它字段", async () => {
    await db.execute(sql`INSERT INTO app_config (id, data) VALUES
      (1, '{"lowStockThreshold": "abc", "smtpPort": 99999, "siteName": "店铺"}'::jsonb)`);
    invalidateConfig();
    const c = await getConfig();
    expect(c.lowStockThreshold).toBe(5);
    expect(c.smtpPort).toBe(465);
    expect(c.siteName).toBe("店铺");
  });

  it("显式设置 0 按设置值保存", async () => {
    await updateConfig({ lowStockThreshold: 0 });
    invalidateConfig();
    expect((await getConfig()).lowStockThreshold).toBe(0);
  });

  it("并发自增不丢失（行锁）", async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => updateConfig((c) => ({ adminSessionVersion: c.adminSessionVersion + 1 })))
    );
    invalidateConfig();
    expect((await getConfig()).adminSessionVersion).toBe(6);
  });

  it("凭据字段只认 enc:v1 密文，明文视为未设置", async () => {
    await db.execute(sql`INSERT INTO app_config (id, data) VALUES
      (1, '{"smtpPassEnc": "plain", "turnstileEnabled": true, "turnstileSiteKey": "k", "turnstileSecretEnc": "plain"}'::jsonb)`);
    invalidateConfig();
    expect((await getSmtpConfig()).pass).toBe("");
    expect(await isTurnstileEnforced()).toBe(false);
    await updateConfig({ smtpPassEnc: encryptSecret("p@ss") });
    expect((await getSmtpConfig()).pass).toBe("p@ss");
  });
});
