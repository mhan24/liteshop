import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// RepurchaseOrder 内部用 useRouter() 做跳转，SSR 渲染需要 App Router 上下文，
// 这里做最小 mock（仅验证按钮渲染条件，不关心跳转行为）。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import { OrderStatusPoll, type OrderStatusPayload } from "./order-status-poll";

/**
 * 组件级回归：重购按钮必须由服务端下发的 canRepurchase 决定，
 * 不得由组件自行用 status 推断。
 *
 * 历史缺陷：按钮条件是 (status === 'expired' || status === 'closed')，
 * 导致「已付款后被关闭」与「有待处理异常到账」的订单也显示按钮，
 * 买家填完邮箱提交才被服务端拒绝（后端规则与前端展示漂移）。
 */

const base: OrderStatusPayload = {
  orderNo: "LS20261012ABCDEFG1",
  status: "expired",
  statusLabel: "已超时",
  productName: "测试商品",
  quantity: 1,
  total: "$0.50",
  emailMasked: "t***@test.dev",
  paymentUrl: null,
  expiresAtText: null,
  productSlug: "test-product",
  canRepurchase: true,
};

function render(props: Partial<OrderStatusPayload>, payCTA = true) {
  return renderToStaticMarkup(
    <OrderStatusPoll orderNo="LS20261012ABCDEFG1" initial={{ ...base, ...props }} payCTA={payCTA} />
  );
}

describe("重购按钮的显示条件", () => {
  it("canRepurchase=true 时显示「重新购买」", () => {
    const html = render({ status: "expired", canRepurchase: true });
    expect(html).toContain("重新购买");
  });

  it("已付款后被关闭（canRepurchase=false）→ 不显示按钮", () => {
    // 关键回归：status 是 closed（旧逻辑会显示按钮），但服务端判定不可重购
    const html = render({
      status: "closed",
      canRepurchase: false,
      repurchaseBlockedReason: "该订单已付款或尚未结束，请联系客服处理",
    });
    expect(html).not.toContain("重新购买");
  });

  it("有待处理异常到账的过期订单（canRepurchase=false）→ 不显示按钮", () => {
    // status 是 expired（旧逻辑会显示按钮），但存在未核实的到账记录
    const html = render({
      status: "expired",
      canRepurchase: false,
      repurchaseBlockedReason: "该订单有一笔待核实的到账记录，为避免重复付款，请联系客服",
    });
    expect(html).not.toContain("重新购买");
  });

  it("canRepurchase 缺省（未下发）→ 不显示按钮（fail closed）", () => {
    // 旧版本若漏传字段，宁可隐藏也不显示
    const html = render({ status: "expired", canRepurchase: undefined });
    expect(html).not.toContain("重新购买");
  });

  it("非待支付页（payCTA=false）→ 不显示按钮", () => {
    const html = render({ status: "expired", canRepurchase: true }, false);
    expect(html).not.toContain("重新购买");
  });

  it("pending / reconciling 状态不显示重购按钮", () => {
    for (const status of ["pending", "reconciling"]) {
      const html = render({ status, canRepurchase: false });
      expect(html).not.toContain("重新购买");
    }
  });
});
