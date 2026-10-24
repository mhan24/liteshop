import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { admins } from "@/db/schema";
import {
  hashPassword,
  loginAdmin,
  verifyPassword,
  csrfToken,
  ensureAdminBootstrapped,
} from "@/server/admin-auth";
import { resetDb } from "../helpers";

// loginAdmin 内部读取请求头（限速 IP）；测试环境模拟空请求头
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

/** 管理员鉴权：scrypt 密码、引导、限速、无状态 CSRF 令牌 */
describe("管理员鉴权", () => {
  beforeEach(async () => {
    await resetDb();
    await db.insert(admins).values({ username: "admin", passwordHash: hashPassword("super-secret-1") });
  });

  it("scrypt 哈希可验证，错密码拒绝", () => {
    const hash = hashPassword("super-secret-1");
    expect(verifyPassword("super-secret-1", hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
    expect(verifyPassword("super-secret-1", "garbage")).toBe(false);
  });

  it("表为空且未配置 env 哈希时不引导", async () => {
    await resetDb();
    await ensureAdminBootstrapped();
    const rows = await db.select().from(admins);
    expect(rows).toHaveLength(0);
  });

  it("错误密码连续失败触发限速（锁定中正确密码也拒绝）", async () => {
    const username = "ratelimit-admin";
    await db.insert(admins).values({ username, passwordHash: hashPassword("right-password") });
    for (let i = 0; i < 5; i++) {
      const r = await loginAdmin(username, "wrong-password");
      expect(r).toBeNull();
    }
    const blocked = await loginAdmin(username, "right-password");
    expect(blocked).toBeNull();
  });

  it("正确密码登录成功并返回会话", async () => {
    const session = await loginAdmin("admin", "super-secret-1");
    expect(session).toEqual({ username: "admin" });
  });

  it("CSRF 令牌与会话版本绑定（同版本稳定、换版本失效）", async () => {
    const t1 = await csrfToken();
    const t2 = await csrfToken();
    expect(t1).toBe(t2);
    const { bumpAdminSessionVersion } = await import("@/server/settings");
    await bumpAdminSessionVersion();
    const t3 = await csrfToken();
    expect(t3).not.toBe(t1);
  });
});
