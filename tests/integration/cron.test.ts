import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { deliveries } from "@/db/schema";
import * as mail from "@/server/mail";
import { createOrder } from "@/server/orders";
import { resetDb, seedAutoProduct, payOrderWithMock, orderWithPayment } from "../helpers";
import { POST } from "@/app/api/cron/maintenance/route";

/** 回归：cron 密钥只接受 Authorization 头（不再接受会进访问日志的 ?key=） */
describe("维护任务鉴权", () => {
  const url = "http://localhost/api/cron/maintenance";

  it("缺少或错误的 Bearer 令牌返回 403", async () => {
    expect((await POST(new Request(url, { method: "POST" }))).status).toBe(403);
    expect((await POST(new Request(`${url}?key=test-cron-secret`, { method: "POST" }))).status).toBe(403);
    const wrong = new Request(url, { method: "POST", headers: { authorization: "Bearer nope" } });
    expect((await POST(wrong)).status).toBe(403);
  });

  it("正确令牌执行维护并返回结果", async () => {
    const ok = new Request(url, { method: "POST", headers: { authorization: "Bearer test-cron-secret" } });
    const res = await POST(ok);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("重叠的维护请求只执行一轮投递", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const send = vi.spyOn(mail, "flushDeliveryEmails").mockResolvedValue({ sent: 0, failed: 0 }).mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return { sent: 0, failed: 0 };
    });
    const post = () => POST(new Request(url, { method: "POST", headers: { authorization: "Bearer test-cron-secret" } }));
    const first = post();
    try {
      await Promise.race([entered.promise, first.then(() => { throw new Error("维护提前结束"); })]);
      expect(await (await post()).json()).toMatchObject({ ok: true, skipped: true });
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      await first.finally(() => send.mockRestore());
    }
  });

  it("SMTP 停用期间保留卡密邮件的重试次数", async () => {
    await resetDb();
    await seedAutoProduct("mail-retry", 1);
    const result = await createOrder({ email: "a@test.dev", items: [{ slug: "mail-retry", quantity: 1 }] });
    await payOrderWithMock(result.orderNo);
    expect(await mail.flushDeliveryEmails()).toEqual({ sent: 0, failed: 0 });
    const { order } = await orderWithPayment(result.orderNo);
    const [delivery] = await db.select().from(deliveries).where(eq(deliveries.orderId, order.id));
    expect(delivery).toMatchObject({ emailAttempts: 0, emailSentAt: null });
  });
});
