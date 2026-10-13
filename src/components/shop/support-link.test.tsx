import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SupportLink } from "./support-link";

/**
 * 客服入口：地址由服务端下发；为空时不得渲染任何内容，
 * 且链接必须是安全的新窗口外链。
 */

describe("SupportLink", () => {
  it("渲染为安全的新窗口外链", () => {
    const html = renderToStaticMarkup(
      <SupportLink url="https://t.me/setup0de?direct" label="联系客服" />
    );
    expect(html).toContain('href="https://t.me/setup0de?direct"');
    expect(html).toContain('target="_blank"');
    // 防 tabnabbing：必须带 noopener/noreferrer
    expect(html).toContain("noopener");
    expect(html).toContain("noreferrer");
    expect(html).toContain("联系客服");
  });

  it("url 为空/null/undefined 时不渲染任何内容", () => {
    for (const url of [null, undefined, ""]) {
      expect(renderToStaticMarkup(<SupportLink url={url} label="联系客服" />)).toBe("");
    }
  });

  it("自定义文案生效", () => {
    const html = renderToStaticMarkup(
      <SupportLink url="https://t.me/x" label="有问题点这里" />
    );
    expect(html).toContain("有问题点这里");
  });
});
