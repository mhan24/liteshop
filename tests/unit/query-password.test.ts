import { describe, expect, it } from "vitest";
import { generateQueryPassword, hashQueryPassword, verifyQueryPassword } from "@/lib/query-password";

describe("查单密码（Argon2id）", () => {
  it("生成 8 位、无易混淆字符", () => {
    for (let i = 0; i < 50; i++) {
      const pwd = generateQueryPassword();
      expect(pwd).toMatch(/^[2-9A-Z]{8}$/);
    }
  });

  it("哈希可验证，错密码拒绝", async () => {
    const pwd = generateQueryPassword();
    const hash = await hashQueryPassword(pwd);
    expect(hash).toContain("$argon2id$");
    await expect(verifyQueryPassword(hash, pwd)).resolves.toBe(true);
    const wrong = pwd === "2AAAAAAA" ? "2BBBBBBB" : "2AAAAAAA";
    await expect(verifyQueryPassword(hash, wrong)).resolves.toBe(false);
  });

  it("畸形输入不抛错、返回 false（抹平时间差）", async () => {
    const hash = await hashQueryPassword(generateQueryPassword());
    await expect(verifyQueryPassword(hash, "bad input!")).resolves.toBe(false);
    await expect(verifyQueryPassword(hash, "12345678")).resolves.toBe(false);
    await expect(verifyQueryPassword(hash, "abcdefgh")).resolves.toBe(false);
  });
});
