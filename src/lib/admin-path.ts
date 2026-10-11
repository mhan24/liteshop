import { headers } from "next/headers";
import { getSetting } from "@/server/settings";

export const DEFAULT_ADMIN_PATH = "admin";
export const ADMIN_BASE_HEADER = "x-admin-base";

export function isValidAdminPath(p: string): boolean {
  return /^[a-z0-9-]{3,32}$/.test(p);
}

/** 后台入口路径（settings.admin_path，默认 admin） */
export function getAdminPath(): string {
  const p = getSetting("admin_path")?.trim().toLowerCase();
  return p && isValidAdminPath(p) ? p : DEFAULT_ADMIN_PATH;
}

/**
 * 当前请求的后台基础路径（服务端组件/Action 用）。
 * 中间件在入口伪装（rewrite）时注入 x-admin-base；未注入时回落 settings 值。
 */
export async function getAdminBase(): Promise<string> {
  const h = await headers();
  const injected = h.get(ADMIN_BASE_HEADER);
  if (injected && injected.startsWith("/")) return injected;
  return `/${getAdminPath()}`;
}
