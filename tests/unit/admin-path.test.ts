import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "@/proxy";
import { normalizeAdminPath, resolveAdminRoute } from "@/lib/admin-path";

describe("后台入口伪装", () => {
  it("默认 /admin 原样放行", () => {
    expect(resolveAdminRoute("/admin/login", "/admin")).toEqual({ kind: "pass" });
  });

  it("自定义入口改写到 /admin 并保留子路径（回归：旧实现丢掉 /admin 前缀且 matcher 不覆盖自定义路径）", () => {
    expect(resolveAdminRoute("/secret-x", "/secret-x")).toEqual({ kind: "rewrite", to: "/admin" });
    expect(resolveAdminRoute("/secret-x/login", "/secret-x")).toEqual({ kind: "rewrite", to: "/admin/login" });
    expect(resolveAdminRoute("/secret-x/orders", "/secret-x")).toEqual({ kind: "rewrite", to: "/admin/orders" });
  });

  it("自定义入口时直接访问 /admin 返回 404，前缀相似的路径不受影响", () => {
    expect(resolveAdminRoute("/admin", "/secret-x")).toEqual({ kind: "not-found" });
    expect(resolveAdminRoute("/admin/login", "/secret-x")).toEqual({ kind: "not-found" });
    expect(resolveAdminRoute("/secret-xyz", "/secret-x")).toEqual({ kind: "pass" });
    expect(resolveAdminRoute("/administrator", "/secret-x")).toEqual({ kind: "pass" });
    expect(resolveAdminRoute("/products/a", "/secret-x")).toEqual({ kind: "pass" });
  });

  it("代理覆盖自定义入口及其子页，精确排除系统路由和静态文件", () => {
    for (const path of ["/admin/login", "/robots-txt-ops/orders", "/api-admin", "/sitemap-xml"]) {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path })).toBe(true);
    }
    for (const path of ["/api", "/api/health", "/_next/static/app.js", "/_next/image", "/robots.txt", "/sitemap.xml", "/favicon.ico"]) {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path })).toBe(false);
    }
  });

  it("规范化：去尾斜杠，空值与根路径回落 /admin", () => {
    expect(normalizeAdminPath("/secret/")).toBe("/secret");
    expect(normalizeAdminPath(undefined)).toBe("/admin");
    expect(normalizeAdminPath("/")).toBe("/admin");
  });
});
