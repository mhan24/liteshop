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

describe("客服入口在订单状态页的渲染", () => {
  const SUPPORT = { url: "https://t.me/setup0de?direct", label: "联系客服" };
  const renderWith = (
    props: Partial<OrderStatusPayload>,
    support?: { url: string | null; label: string }
  ) =>
    renderToStaticMarkup(
      <OrderStatusPoll
        orderNo="LS20261012ABCDEFG1"
        initial={{ ...base, ...props }}
        payCTA
        support={support}
      />
    );

  it("订单过期时提示可点击的客服入口", () => {
    const html = renderWith({ status: "expired", canRepurchase: true }, SUPPORT);
    expect(html).toContain("联系客服");
    expect(html).toContain('href="https://t.me/setup0de?direct"');
    expect(html).toContain("如已付款请");
  });

  it("待对账（reconciling）时提示客服核对", () => {
    const html = renderWith({ status: "reconciling", canRepurchase: false }, SUPPORT);
    expect(html).toContain('href="https://t.me/setup0de?direct"');
    expect(html).toContain("请勿重复付款");
  });

  it("订单关闭时提示客服核实", () => {
    const html = renderWith({ status: "closed", canRepurchase: true }, SUPPORT);
    expect(html).toContain('href="https://t.me/setup0de?direct"');
  });

  it("未配置客服地址时不渲染链接（仅保留文字）", () => {
    const html = renderWith({ status: "expired", canRepurchase: true }, undefined);
    expect(html).not.toContain("t.me/setup0de");
    // 提示文案仍在，只是没有可点击入口
    expect(html).toContain("如已付款请");
  });

  it("客服地址留空时不渲染链接", () => {
    const html = renderWith(
      { status: "expired", canRepurchase: true },
      { url: null, label: "联系客服" }
    );
    expect(html).not.toContain('target="_blank"');
  });

  it("自定义客服文案生效", () => {
    const html = renderWith({ status: "expired", canRepurchase: true }, {
      url: "https://t.me/x",
      label: "点此找人工",
    });
    expect(html).toContain("点此找人工");
  });
});
