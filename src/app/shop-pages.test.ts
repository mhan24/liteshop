import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 页面配置一致性：任何启用 payCTA 的页面都必须同时下发
 * turnstile 与 canRepurchase，否则会前后端规则漂移。
 *
 * 历史缺陷：pay/return 启用了 payCTA 却没传 turnstile，
 * 开启 Turnstile 后该页重购因缺少 cfToken 被服务端拒绝（功能缺陷）。
 */

const PAGES = [
  { name: "pay/return", file: "src/app/(shop)/pay/return/page.tsx" },
  { name: "pay/pending", file: "src/app/(shop)/pay/pending/page.tsx" },
];

function readPage(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("启用 payCTA 的页面必须配置完整", () => {
  for (const page of PAGES) {
    it(`${page.name} 同时下发 turnstile 与 canRepurchase`, () => {
      const src = readPage(page.file);
      expect(src).toContain("payCTA");
      expect(src).toContain("turnstile");
      expect(src).toContain("canRepurchase");
      expect(src).toContain("repurchaseBlockedReason");
    });
  }

  it("两个页面都不再用 status 自行推断重购资格", () => {
    for (const page of PAGES) {
      const src = readPage(page.file);
      expect(src).not.toMatch(/status === "expired" \|\| .*status === "closed"/);
    }
  });
});
