import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { encryptSecret } from "@/lib/secret-box";
import { deleteCategoryAction, deleteProductAction, saveSmtpAction, updateProductAction } from "@/actions/admin";
import { getConfig, getSmtpConfig, updateConfig } from "@/server/settings";
import { admins, orderItems, orders, products } from "@/db/schema";
import {
  changeAdminCredentials,
  createSessionCookie,
  getAdminSession,
  hashPassword,
  loginAdmin,
  verifyPassword,
  csrfToken,
  ensureAdminBootstrapped,
} from "@/server/admin-auth";
import { resetDb } from "../helpers";

// loginAdmin 内部读取请求头（限速 IP）；测试环境模拟空请求头
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const cookiesJar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => ({ value: cookiesJar.get(name) }),
    set: (name: string, value: string) => cookiesJar.set(name, value),
    delete: (name: string) => cookiesJar.delete(name),
  }),
}));

/** 管理员鉴权：scrypt 密码、引导、限速、无状态 CSRF 令牌 */
describe("管理员鉴权", () => {
  beforeEach(async () => {
    cookiesJar.clear();
    await resetDb();
    await db.insert(admins).values({ username: "admin", passwordHash: hashPassword("super-secret-1") });
  });

  it("scrypt 哈希可验证，错密码拒绝", () => {
    const hash = hashPassword("super-secret-1");
    expect(verifyPassword("super-secret-1", hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
    expect(verifyPassword("super-secret-1", "garbage")).toBe(false);
    expect(verifyPassword("super-secret-1", hash.slice(0, -1))).toBe(false);
    expect(verifyPassword("super-secret-1", hash.replace(/:[^:]+$/, ":"))).toBe(false);
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
    expect(session).toEqual({ username: "admin", version: 1 });
  });

  it("改密撤销已有会话，也撤销在改密之前完成密码校验的登录", async () => {
    const previous = await loginAdmin("admin", "super-secret-1");
    expect(previous).not.toBeNull();
    await createSessionCookie(previous!);
    expect(await getAdminSession()).toEqual(previous);
    expect(await changeAdminCredentials("admin", "super-secret-1", "admin", "super-secret-2")).toBe(true);
    expect(await getAdminSession()).toBeNull();
    await createSessionCookie(previous!);
    expect(await getAdminSession()).toBeNull();
    expect(await changeAdminCredentials("admin", "super-secret-1", "admin", "other-password")).toBe(false);
    const current = await loginAdmin("admin", "super-secret-2");
    expect(current?.version).toBe(2);
    await createSessionCookie(current!);
    expect(await getAdminSession()).toEqual(current);
  });

  it("会话版本写入失败时回滚密码修改", async () => {
    await updateConfig({ adminSessionVersion: 1 });
    await db.execute(sql`ALTER TABLE app_config ADD CONSTRAINT test_hold_version CHECK ((data->>'adminSessionVersion')::bigint = 1)`);
    try {
      await expect(changeAdminCredentials("admin", "super-secret-1", "admin", "super-secret-2")).rejects.toThrow();
      expect(await loginAdmin("admin", "super-secret-1")).toEqual({ username: "admin", version: 1 });
    } finally {
      await db.execute(sql`ALTER TABLE app_config DROP CONSTRAINT test_hold_version`);
    }
  });

  it("保存 SMTP 时留空密码保留数据库中刚轮换的密文", async () => {
    const session = await loginAdmin("admin", "super-secret-1");
    await createSessionCookie(session!);
    await updateConfig({ smtpPassEnc: encryptSecret("previous-password") });
    await getConfig();
    await db.execute(sql`UPDATE app_config SET data = jsonb_set(data, '{smtpPassEnc}', to_jsonb(${encryptSecret("new-password")}::text)) WHERE id = 1`);
    const form = new FormData();
    form.set("csrf", await csrfToken());
    expect((await saveSmtpAction(null, form)).ok).toBe(true);
    expect((await getSmtpConfig()).pass).toBe("new-password");
  });

  it("缺卡的未完成订单保留商品关联，订单关闭后允许删除", async () => {
    await createSessionCookie((await loginAdmin("admin", "super-secret-1"))!);
    const [product] = await db.insert(products).values({ slug: "missing-stock", name: "待补货", priceCents: 100 }).returning();
    const [order] = await db.insert(orders).values({
      orderNo: "LS-RESTOCK", email: "buyer@example.test", queryPasswordHash: "fixture",
      subtotalCents: 100, totalCents: 100,
    }).returning();
    await db.insert(orderItems).values({
      orderId: order!.id, productId: product!.id, productName: product!.name,
      unitPriceCents: 100, quantity: 1, lineTotalCents: 100,
    });
    const form = new FormData();
    form.set("csrf", await csrfToken());
    form.set("id", String(product!.id));
    for (const status of ["pending", "reconciling", "paid"] as const) {
      await db.update(orders).set({ status }).where(eq(orders.id, order!.id));
      expect((await deleteProductAction(null, form)).ok).toBe(false);
      const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, order!.id));
      expect(item?.productId).toBe(product!.id);
    }
    await db.update(orders).set({ status: "closed" }).where(eq(orders.id, order!.id));
    expect((await deleteProductAction(null, form)).ok).toBe(true);
    expect((await deleteProductAction(null, form)).ok).toBe(false);
    form.set("name", "已删除的商品");
    form.set("slug", product!.slug);
    form.set("priceMinor", "100");
    expect((await updateProductAction(null, form)).ok).toBe(false);
    expect((await deleteCategoryAction(null, form)).ok).toBe(false);
  });

  it("CSRF 令牌与会话版本绑定（同版本稳定、换版本失效）", async () => {
    const t1 = await csrfToken();
    const t2 = await csrfToken();
    expect(t1).toBe(t2);
    const { revokeAllSessions } = await import("@/server/admin-auth");
    await revokeAllSessions();
    const t3 = await csrfToken();
    expect(t3).not.toBe(t1);
  });
});
