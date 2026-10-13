import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted } from "./credentials";

/**
 * 交易所 API 凭据静态加密：明文绝不能落库，
 * 且必须能检测篡改（GCM 认证）而不是解出垃圾数据。
 */

describe("交易所凭据加密", () => {
  it("加解密可往返", () => {
    const plain = "b1n4nce-api-key-secret-值";
    const enc = encryptSecret(plain);
    expect(enc).not.toContain(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("密文带版本前缀，便于将来轮换算法", () => {
    expect(encryptSecret("x").startsWith("enc:v1:")).toBe(true);
    expect(isEncrypted(encryptSecret("x"))).toBe(true);
    expect(isEncrypted("plain-text")).toBe(false);
  });

  it("相同明文每次密文不同（随机 IV）", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    // 但都能解回同一明文
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("篡改密文后认证失败 → 返回 null（绝不返回半解数据）", () => {
    const enc = encryptSecret("important");
    const parts = enc.split(":");
    // 翻转密文最后一个字符
    const ct = parts[4];
    const flipped = ct.slice(0, -2) + (ct.endsWith("A") ? "B" : "A") + ct.slice(-1);
    const tampered = [parts[0], parts[1], parts[2], parts[3], flipped].join(":");
    expect(decryptSecret(tampered)).toBeNull();
  });

  it("篡改认证标签同样失败", () => {
    const enc = encryptSecret("important");
    const parts = enc.split(":");
    parts[3] = Buffer.from("0".repeat(16)).toString("base64");
    expect(decryptSecret(parts.join(":"))).toBeNull();
  });

  it("非法格式返回 null（不抛错）", () => {
    for (const bad of ["", "plain", "enc:v1:", "enc:v1:a:b", "enc:v2:a:b:c", "enc:v1:!!:!!:!!"]) {
      expect(decryptSecret(bad)).toBeNull();
    }
  });

  it("支持空字符串与长密钥", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("");
    const long = "k".repeat(5000);
    expect(decryptSecret(encryptSecret(long))).toBe(long);
  });
});
