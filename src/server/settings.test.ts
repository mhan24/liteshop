import { describe, expect, it, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import {
  isTurnstileEnforced,
  getTurnstileClientConfig,
  setSetting,
  getRepoUrl,
  isSafeHttpUrl,
  DEFAULT_REPO_URL,
  SETTING_KEYS,
} from "./settings";

/** P0 回归：Turnstile 关闭时必须跳过服务端校验，避免买家无法下单/查单 */

describe("Turnstile 强制校验的判据", () => {
  beforeEach(() => {
    for (const k of ["turnstile_enabled", "turnstile_site_key", "turnstile_secret_key"]) {
      db.delete(settings).where(eqKey(k)).run();
    }
  });

  it("全未配置 → 不强制", () => {
    expect(isTurnstileEnforced()).toBe(false);
  });

  it("关键回归：开关关闭但保留 Secret → 不强制（否则买家无法下单/查单）", () => {
    setSetting("turnstile_enabled", "0");
    setSetting("turnstile_secret_key", "secret-kept");
    setSetting("turnstile_site_key", "site-kept");
    expect(isTurnstileEnforced()).toBe(false);
    expect(getTurnstileClientConfig().enabled).toBe(false);
  });

  it("开启但缺 Site 或 Secret → 不强制（配置不完整时不阻塞买家）", () => {
    setSetting("turnstile_enabled", "1");
    setSetting("turnstile_secret_key", "s");
    expect(isTurnstileEnforced()).toBe(false);

    setSetting("turnstile_site_key", "k");
    setSetting("turnstile_secret_key", "");
    expect(isTurnstileEnforced()).toBe(false);
  });

  it("开启且三要素齐备 → 强制，且前端展示", () => {
    setSetting("turnstile_enabled", "1");
    setSetting("turnstile_site_key", "site-key");
    setSetting("turnstile_secret_key", "secret-key");
    expect(isTurnstileEnforced()).toBe(true);
    const cfg = getTurnstileClientConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.siteKey).toBe("site-key");
  });

  it("不展示时不下发 siteKey", () => {
    setSetting("turnstile_enabled", "0");
    setSetting("turnstile_site_key", "site-key");
    expect(getTurnstileClientConfig().siteKey).toBe("");
  });
});

function eqKey(k: string) {
  return eq(settings.key, k);
}

describe("页脚仓库地址：安全校验", () => {
  beforeEach(() => {
    db.delete(settings).where(eq(settings.key, SETTING_KEYS.repoUrl)).run();
  });

  it("未设置时回落默认仓库地址", () => {
    expect(getRepoUrl()).toBe(DEFAULT_REPO_URL);
  });

  it("自定义 http/https 地址被采纳", () => {
    setSetting(SETTING_KEYS.repoUrl, "https://gitlab.com/someone/shop");
    expect(getRepoUrl()).toBe("https://gitlab.com/someone/shop");
    setSetting(SETTING_KEYS.repoUrl, "http://example.com/repo");
    expect(getRepoUrl()).toBe("http://example.com/repo");
  });

  it("留空表示不显示链接", () => {
    setSetting(SETTING_KEYS.repoUrl, "");
    expect(getRepoUrl()).toBeNull();
  });

  it("危险协议被拒并回落默认（防 XSS：该值会输出为 <a href>）", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "not-a-url",
      "//evil.com",
    ]) {
      setSetting(SETTING_KEYS.repoUrl, bad);
      expect(getRepoUrl()).toBe(DEFAULT_REPO_URL);
    }
  });

  it("isSafeHttpUrl 判定正确", () => {
    expect(isSafeHttpUrl("https://github.com/a/b")).toBe(true);
    expect(isSafeHttpUrl("http://localhost:3000")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("//evil.com")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
  });
});
