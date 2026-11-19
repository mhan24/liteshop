import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { settings } from "@/db/schema";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "@/lib/secret-box";
import { getSmtpConfig, getTurnstileSecretKey, isTurnstileEnforced, SETTING_KEYS } from "@/server/settings";
import { encryptPlaintextSecrets, encryptWith } from "../../scripts/db/encrypt-secrets.mjs";
import { resetDb } from "../helpers";

const AUTH_SECRET = process.env.AUTH_SECRET!;

async function raw(key: string) {
  return (await db.select().from(settings).where(eq(settings.key, key)))[0]?.value ?? null;
}

/** 回归：SMTP 密码 / Turnstile Secret 不再明文落库；启动迁移把存量明文一次性加密 */
describe("凭据加密存储", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("迁移脚本与 secret-box 算法互通", () => {
    expect(decryptSecret(encryptWith(AUTH_SECRET, "p@ss"))).toBe("p@ss");
  });

  it("存量明文被加密，读取得到原值；再次执行幂等；已有密文与空值不动", async () => {
    const litepay = encryptSecret("gw-token");
    await db.insert(settings).values([
      { key: SETTING_KEYS.smtpPass, value: "smtp-plain" },
      { key: SETTING_KEYS.turnstileSecretKey, value: "ts-plain" },
      { key: SETTING_KEYS.turnstileSiteKey, value: "site-key" },
      { key: SETTING_KEYS.turnstileEnabled, value: "1" },
      { key: SETTING_KEYS.litepayTokenEnc, value: litepay },
    ]);

    const migrated = await encryptPlaintextSecrets(pool, AUTH_SECRET);
    expect(migrated.sort()).toEqual([SETTING_KEYS.smtpPass, SETTING_KEYS.turnstileSecretKey].sort());
    expect(isEncryptedSecret(await raw(SETTING_KEYS.smtpPass))).toBe(true);
    expect(isEncryptedSecret(await raw(SETTING_KEYS.turnstileSecretKey))).toBe(true);
    expect(await raw(SETTING_KEYS.litepayTokenEnc)).toBe(litepay);

    expect((await getSmtpConfig()).pass).toBe("smtp-plain");
    expect(await getTurnstileSecretKey()).toBe("ts-plain");
    expect(await isTurnstileEnforced()).toBe(true);

    expect(await encryptPlaintextSecrets(pool, AUTH_SECRET)).toEqual([]);
  });

  it("未迁移的明文不会被当作有效凭据使用（不存在双读兼容层）", async () => {
    await db.insert(settings).values([
      { key: SETTING_KEYS.smtpPass, value: "smtp-plain" },
      { key: SETTING_KEYS.turnstileSecretKey, value: "ts-plain" },
      { key: SETTING_KEYS.turnstileSiteKey, value: "site-key" },
      { key: SETTING_KEYS.turnstileEnabled, value: "1" },
    ]);
    expect((await getSmtpConfig()).pass).toBe("");
    expect(await isTurnstileEnforced()).toBe(false);
  });

  it("AUTH_SECRET 缺失时拒绝执行", async () => {
    await expect(encryptPlaintextSecrets(pool, undefined)).rejects.toThrow(/AUTH_SECRET/);
  });
});
