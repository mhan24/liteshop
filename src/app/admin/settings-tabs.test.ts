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
    for (const title of [
      "站点",
      "支付渠道 · bepusdt",
      "人机验证（Cloudflare Turnstile）",
      "邮件通知（SMTP）",
      "前台文案",
      "管理员与后台入口",
    ]) {
      expect(src, `设置卡片丢失: ${title}`).toContain(title);
    }
  });

  it("默认选项卡由 ?tab= 决定（保存后能回到原页签）", () => {
    expect(src).toContain("defaultValue={activeTab}");
    expect(src).toContain("TAB_KEYS");
  });

  it("每个 save action 都带回所属选项卡", () => {
    const actions = read(ADMIN_ACTIONS);
    // 设置页的保存动作都应显式传 tab，避免保存后跳回第一个页签
    const settingsBacks = actions.match(/back\("\/admin\/settings"[^)]*\)/g) ?? [];
    expect(settingsBacks.length).toBeGreaterThan(10);
    const withoutTab = settingsBacks.filter(
      (c) => !/"(site|pay|security|notify|copy)"\s*\)$/.test(c.trim())
    );
    expect(withoutTab, `缺少 tab 参数：\n${withoutTab.join("\n")}`).toHaveLength(0);
  });
});
