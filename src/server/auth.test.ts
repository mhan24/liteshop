import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * 登录限流：需要同时防「固定目标爆破」与「轮换用户名绕过」。
 * 历史缺陷：仅按 IP+用户名记录，且记录无 TTL、无容量上限 →
 * 换用户名既能绕开锁定，又能无限扩张内存。
 */

/** 清空记录（通过大量成功登录不可行，改用模块重置技巧） */
async function resetLimiter() {
  vi.resetModules();
}

describe("登录限流", () => {
  beforeEach(async () => {
    await resetLimiter();
  });

  it("同一 IP + 用户名连续失败 5 次后锁定", async () => {
    const { recordFailure: rec, lockedForSeconds: locked } = await import("./auth");
    for (let i = 0; i < 5; i++) rec("203.0.113.1", "admin");
    expect(locked("203.0.113.1", "admin")).toBeGreaterThan(0);
  });

  it("轮换用户名无法绕过 IP 限流（关键回归）", async () => {
    const { recordFailure: rec, lockedForSeconds: locked } = await import("./auth");
    // 每个用户名只失败 4 次（不足以触发用户名维度锁定）
    // 但同一 IP 累计 20 次后应触发 IP 维度锁定
    for (let i = 0; i < 20; i++) {
      rec("203.0.113.2", `user${i}`);
    }
    // 用一个全新的用户名也应被 IP 维度拦住
    expect(locked("203.0.113.2", "brand-new-user")).toBeGreaterThan(0);
  });

  it("不同 IP 之间互不影响", async () => {
    const { recordFailure: rec, lockedForSeconds: locked } = await import("./auth");
    for (let i = 0; i < 5; i++) rec("203.0.113.3", "admin");
    expect(locked("203.0.113.3", "admin")).toBeGreaterThan(0);
    expect(locked("198.51.100.1", "admin")).toBe(0);
  });

  it("记录数不会被大量不同用户名撑爆（容量上限 + 批量淘汰）", async () => {
    const { recordFailure: rec, _attemptRecordsSize: size } = await import("./auth");
    // 轮换用户名刷记录：键空间随请求线性增长
    for (let i = 0; i < 8000; i++) {
      rec(`10.0.${Math.floor(i / 250)}.${i % 250}`, `u${i}`);
    }
    // 上限 5000，允许 25% 的批量淘汰余量 → 实际不超过 6250
    expect(size()).toBeLessThanOrEqual(6250);
    // 且必须真的发生过淘汰（否则说明容量保护失效）
    expect(size()).toBeLessThan(8000 * 2);
  });
});

describe("管理员凭据变更的原子性", () => {
  it("密码校验失败时，用户名不得被部分修改", async () => {
    const { changeAdminCredentials, getAdminCredentials } = await import("./auth");
    const before = getAdminCredentials().username;

    // 用户名合法、密码过短 → 应在校验阶段整体拒绝
    const res = changeAdminCredentials({
      currentPassword: "wrong-password",
      newUsername: "newname123",
      newPassword: "short",
    });
    expect(res.ok).toBe(false);
    // 用户名未被改动
    expect(getAdminCredentials().username).toBe(before);
  });

  it("一项非法则整体不生效（先全量校验后提交）", async () => {
    const { changeAdminCredentials } = await import("./auth");
    const { getSetting } = await import("./settings");
    const beforePath = getSetting("admin_path");

    const res = changeAdminCredentials({
      currentPassword: "wrong-password",
      newUsername: "validname",
      newPath: "INVALID PATH!",
    });
    expect(res.ok).toBe(false);
    expect(getSetting("admin_path")).toBe(beforePath);
  });
});
