import { describe, expect, it, vi } from "vitest";
import { bepusdtProvider } from "./bepusdt";

/**
 * 复审 P2：data.trade_id / payment_url 类型错误时，
 * truthy 对象能通过 !data.trade_id 检查，随后写入 SQLite 文本列会失败。
 * 该失败发生在 createPayment 的 try/catch **之外**（回写阶段），
 * 订单会停留在 pending、无有效期、却已占用库存。
 */

const CFG = { api_base: "https://pay.example.com", token: "tok" };
const call = (body: unknown, no: string) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
  return bepusdtProvider(CFG).createPayment({
    orderNo: no, amountCents: 100n, currency: "CNY", subject: "T",
    notifyUrl: "https://s/n", redirectUrl: "https://s/r",
  });
};

describe("网关关键字段类型校验", () => {
  it("payment_url 为对象 → 必须拒绝（不得进入 SQLite 绑定）", async () => {
    await expect(
      call({ status_code: 200, data: { trade_id: "gw_1", payment_url: { url: "https://x" } } }, "LS20261013TYP00001")
    ).rejects.toMatchObject({ outcome: "unknown" });
  });

  it("trade_id 为对象 → 必须拒绝", async () => {
    await expect(
      call({ status_code: 200, data: { trade_id: { id: "x" }, payment_url: "https://x" } }, "LS20261013TYP00002")
    ).rejects.toMatchObject({ outcome: "unknown" });
  });

  it("trade_id / payment_url 为数字 → 必须拒绝", async () => {
    await expect(
      call({ status_code: 200, data: { trade_id: 12345, payment_url: "https://x" } }, "LS20261013TYP00003")
    ).rejects.toMatchObject({ outcome: "unknown" });
    await expect(
      call({ status_code: 200, data: { trade_id: "gw_2", payment_url: 999 } }, "LS20261013TYP00004")
    ).rejects.toMatchObject({ outcome: "unknown" });
  });

  it("trade_id / payment_url 为空白字符串 → 必须拒绝", async () => {
    await expect(
      call({ status_code: 200, data: { trade_id: "   ", payment_url: "https://x" } }, "LS20261013TYP00005")
    ).rejects.toMatchObject({ outcome: "unknown" });
    await expect(
      call({ status_code: 200, data: { trade_id: "gw_3", payment_url: "" } }, "LS20261013TYP00006")
    ).rejects.toMatchObject({ outcome: "unknown" });
  });

  it("payment_url 为数组 → 必须拒绝", async () => {
    await expect(
      call({ status_code: 200, data: { trade_id: "gw_4", payment_url: ["https://x"] } }, "LS20261013TYP00007")
    ).rejects.toMatchObject({ outcome: "unknown" });
  });

  it("合法字符串字段不受影响（回归保护）", async () => {
    const r = await call(
      { status_code: 200, data: { trade_id: "gw_ok", payment_url: "https://gw/pay/x", expiration_time: 900 } },
      "LS20261013TYP00008"
    );
    expect(r.tradeId).toBe("gw_ok");
    expect(typeof r.paymentUrl).toBe("string");
  });
});
