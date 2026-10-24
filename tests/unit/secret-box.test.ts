import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret, isEncryptedSecret } from "@/lib/secret-box";

describe("支付凭据静态加密（AES-256-GCM）", () => {
  it("加解密往返", () => {
    const plain = "2baa49af10fd33501f681236b779def5a50abfa58206943a";
    const enc = encryptSecret(plain);
    expect(isEncryptedSecret(enc)).toBe(true);
    expect(decryptSecret(enc)).toBe(plain);
    expect(enc).not.toContain(plain);
  });

  it("密文被篡改时解密失败（GCM 认证）", () => {
    const enc = encryptSecret("secret");
    const tampered = enc.slice(0, -4) + "AAAA";
    expect(decryptSecret(tampered)).toBeNull();
  });

  it("非本格式输入返回 null", () => {
    expect(decryptSecret("not-encrypted")).toBeNull();
    expect(isEncryptedSecret(null)).toBe(false);
  });
});
