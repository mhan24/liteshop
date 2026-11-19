import { describe, expect, it } from "vitest";
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
});
