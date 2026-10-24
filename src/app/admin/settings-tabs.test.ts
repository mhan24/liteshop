import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 设置页的结构守护。
 *
 * 背景：设置项过多，已按用途拆成选项卡。这类"搬运式"重构最容易
 * 静默丢卡片（把某个 Card 漏在 TabsContent 之外，或整段被覆盖）。
 * 这里断言每个分区都还在、都被 TabsContent 包住。
 */

const PAGE = "src/app/admin/(panel)/settings/page.tsx";
const ADMIN_ACTIONS = "src/actions/admin.ts";
// 支付渠道卡片在统一表单客户端组件里（设置页只挂载 <PaymentChannelForms />）
const PAYMENT_FORMS = "src/components/admin/payment-channel-forms.tsx";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

describe("设置页选项卡结构", () => {
  const src = read(PAGE);

  it("包含全部五个分区，且各自被 TabsContent 包裹", () => {
    for (const tab of ["site", "pay", "security", "notify", "copy"]) {
      expect(src, `缺少 TabsContent: ${tab}`).toContain(`<TabsContent value="${tab}"`);
      expect(src, `缺少 TabsTrigger: ${tab}`).toContain(`<TabsTrigger value="${tab}"`);
    }
  });

  it("原有六张设置卡片一张都没丢", () => {
    const paymentForms = read(PAYMENT_FORMS);
    for (const [title, container] of [
      ["站点", src],
      ["支付渠道 · bepusdt", paymentForms],
      ["支付渠道 · litepay", paymentForms],
      ["人机验证（Cloudflare Turnstile）", src],
      ["邮件通知（SMTP）", src],
      ["前台文案", src],
      ["管理员与后台入口", src],
    ] as const) {
      expect(container, `设置卡片丢失: ${title}`).toContain(title);
    }
  });

  it("支付渠道为统一保存：单个表单、单一提交按钮、useActionState 内联结果", () => {
    const paymentForms = read(PAYMENT_FORMS);
    // 一个表单承载两个渠道
    expect(paymentForms.match(/<form /g)?.length).toBe(1);
    expect(paymentForms).toContain("savePaymentChannelsAction");
    expect(paymentForms).toContain("useActionState");
    // 结果内联渲染（POST 响应内），不经过 ?flash= GET 重定向
    expect(paymentForms).toContain("<Flash");
    // 每个渠道字段带渠道前缀，统一 action 可区分
    for (const field of ["bepusdt.apiBase", "litepay.apiBase", "bepusdt.enabled", "litepay.enabled"]) {
      expect(paymentForms, `缺少字段: ${field}`).toContain(`name="${field}"`);
    }
    // 设置页不再保留各渠道独立表单
    expect(src).not.toContain("savePaymentConfigAction");
    expect(src).not.toContain("saveLitepayConfigAction");
  });

  it("统一保存 action 结果直接返回状态（不再 redirect 回传）", () => {
    const actions = read(ADMIN_ACTIONS);
    expect(actions).toContain("savePaymentChannelsAction");
    // 该 action 内不允许出现 back("/admin/settings"（结果走 useActionState 返回）
    const actionBody = actions.slice(actions.indexOf("savePaymentChannelsAction"));
    const smtpStart = actionBody.indexOf("saveSmtpSettingsAction");
    expect(
      actionBody.slice(0, smtpStart),
      "统一保存 action 不应使用 back() 重定向"
    ).not.toContain('back("/admin/settings"');
  });

  it("默认选项卡由 ?tab= 决定（保存后能回到原页签）", () => {
    expect(src).toContain("defaultValue={activeTab}");
    expect(src).toContain("TAB_KEYS");
  });

  it("其余每个 save action 都带回所属选项卡", () => {
    const actions = read(ADMIN_ACTIONS);
    // 设置页的保存动作都应显式传 tab，避免保存后跳回第一个页签
    // （支付渠道统一保存不走 back/redirect，见上方用例）
    const settingsBacks = actions.match(/back\("\/admin\/settings"[^)]*\)/g) ?? [];
    expect(settingsBacks.length).toBeGreaterThan(10);
    const withoutTab = settingsBacks.filter(
      (c) => !/"(site|pay|security|notify|copy)"\s*\)$/.test(c.trim())
    );
    expect(withoutTab, `缺少 tab 参数：\n${withoutTab.join("\n")}`).toHaveLength(0);
  });
});
