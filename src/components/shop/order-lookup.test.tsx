import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 查单页人机验证回归。
 *
 * 真实故障：TurnstileWidget 已在客户端通过，但表单里**没有** cfToken 隐藏域，
 * 服务端 lookupOrderAction 收到的永远是空串 → 查单恒定报「人机验证未通过」。
 * 这类问题在关掉验证码时完全看不出来（isTurnstileEnforced() 为 false 会跳过校验）。
 */

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("查单页 Turnstile token 传递", () => {
  const src = read("src/components/shop/order-lookup.tsx");

  it("渲染验证码时必须把 token 放进表单（cfToken 隐藏域）", () => {
    expect(src).toContain('type="hidden"');
    expect(src).toMatch(/name="cfToken"/);
    expect(src).toMatch(/value=\{token \?\? ""\}/);
  });

  it("服务端确实从 formData 读取 cfToken（两端必须对齐）", () => {
    const actions = read("src/actions/shop.ts");
    expect(actions).toContain('formData.get("cfToken")');
  });

  it("所有使用 TurnstileWidget 的表单组件都必须传 cfToken", () => {
    const files = [
      "src/components/shop/order-lookup.tsx",
      "src/components/shop/order-status-poll.tsx",
      "src/components/shop/buy-form.tsx",
    ];
    for (const f of files) {
      expect(read(f), `${f} 缺少 cfToken`).toMatch(/name="cfToken"/);
    }
  });
});

/**
 * 本地订单缓存与查单页的衔接。
 *
 * 安全边界：缓存只是「输入便利」，服务端仍按订单号 + 邮箱双因子校验，
 * 因此缓存不得成为可越权访问订单的凭据。
 */
describe("查单页本地历史", () => {
  const src = read("src/components/shop/order-lookup.tsx");

  it("读取本地缓存并提供一键填充", () => {
    expect(src).toContain("readCachedOrders");
    expect(src).toContain("setOrderNo");
    expect(src).toContain("setEmail");
  });

  it("提供清除本地记录的入口", () => {
    expect(src).toContain("clearCachedOrders");
  });

  it("未支付订单提供「重新支付」与「取消」操作", () => {
    expect(src).toContain("重新支付");
    expect(src).toContain("CancelOrder");
  });

  it("页面明示缓存仅本机保存，服务端仍双因子校验", () => {
    expect(src).toContain("仅保存在本机");
    expect(src).toContain("订单号 + 邮箱");
  });

  it("取消操作仍走服务端校验（缓存不提供授权）", () => {
    const actions = read("src/actions/shop.ts");
    expect(actions).toMatch(/cancelPendingOrder\(orderNo,\s*email\)/);
  });
});
