/**
 * 后台入口伪装：ADMIN_PATH（默认 /admin）是后台唯一的对外入口。
 *
 * - ADMIN_PATH=/admin：/admin/** 原样放行
 * - ADMIN_PATH=/xyz  ：/xyz/** 内部改写到 /admin/**；直接访问 /admin/** 返回 404
 */

export type AdminRouteDecision =
  | { kind: "pass" }
  | { kind: "rewrite"; to: string }
  | { kind: "not-found" };

export function normalizeAdminPath(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  return trimmed.startsWith("/") && trimmed.length > 1 ? trimmed : "/admin";
}

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function resolveAdminRoute(pathname: string, adminPath: string): AdminRouteDecision {
  if (adminPath === "/admin") return { kind: "pass" };
  if (under(pathname, adminPath)) return { kind: "rewrite", to: `/admin${pathname.slice(adminPath.length)}` };
  if (under(pathname, "/admin")) return { kind: "not-found" };
  return { kind: "pass" };
}
