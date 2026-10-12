import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ADMIN_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * 后台守卫 + 入口路径伪装（PLAN §6-③）：
 * - settings.admin_path 可自定义入口（如 /my-panel）；伪装后 /admin/* 一律 404
 * - 命中入口时校验会话，并注入 x-admin-base 供页面生成链接
 * - admin_path 直读 SQLite（nodejs runtime；open 失败回落 admin）
 */

const RESERVED = new Set([
  "admin", "api", "products", "orders", "pay", "static", "_next", "assets",
  "favicon.ico", "robots.txt", "sitemap.xml", "settings", "login", "logout",
]);

/**
 * admin_path 的进程内缓存。
 *
 * 中间件匹配几乎所有路径（见 config.matcher），若每个请求都打开 SQLite 读取
 * 后台入口，静态资源与外链访问都会产生一次不必要的文件打开——在容器里
 * 这是可观的系统调用开销。入口路径极少变动，故缓存并设 TTL。
 *
 * 变更生效延迟最多 TTL；保存设置时会通过 settings 的 updatedAt 触发失效
 * （见下方 shouldRefresh）。
 */
const ADMIN_PATH_TTL_MS = 10_000;
let cachedAdminPath: { value: string; at: number } | null = null;

function getAdminPathSync(): string {
  const now = Date.now();
  if (cachedAdminPath && now - cachedAdminPath.at < ADMIN_PATH_TTL_MS) {
    return cachedAdminPath.value;
  }
  const value = readAdminPathFromDb();
  cachedAdminPath = { value, at: now };
  return value;
}

/** 供设置变更后主动失效（同一进程内立即生效，无需等 TTL） */
export function invalidateAdminPathCache(): void {
  cachedAdminPath = null;
}

function readAdminPathFromDb(): string {
  try {
    const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
    const dbPath = process.env.DATABASE_PATH ?? path.join(dataDir, "liteshop.db");
    if (!fs.existsSync(dbPath)) return "admin";
    const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = sqlite.prepare("SELECT value FROM settings WHERE key = 'admin_path'").get() as
        | { value: string }
        | undefined;
      const p = row?.value?.trim().toLowerCase();
      if (p && /^[a-z0-9-]{3,32}$/.test(p) && !RESERVED.has(p)) return p;
    } finally {
      sqlite.close();
    }
  } catch {
    // DB 未就绪等情况回落默认
  }
  return "admin";
}

async function withAuth(
  request: NextRequest,
  adminBase: string,
  respond: (opts: { request: { headers: Headers } }) => NextResponse
): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (pathname === `${adminBase}/login`) return respond(withBaseHeader(request, adminBase));

  const token = request.cookies.get(ADMIN_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = `${adminBase}/login`;
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return respond(withBaseHeader(request, adminBase));
}

function withBaseHeader(request: NextRequest, adminBase: string): { request: { headers: Headers } } {
  const headers = new Headers(request.headers);
  headers.set("x-admin-base", adminBase);
  return { request: { headers } };
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const adminPath = getAdminPathSync();
  const adminBase = `/${adminPath}`;

  // 命中伪装入口 → 鉴权 + （非 admin 时）改写到内部 /admin/* 路由
  if (pathname === adminBase || pathname.startsWith(adminBase + "/")) {
    const respond = (opts: { request: { headers: Headers } }) => {
      if (adminPath === "admin") return NextResponse.next(opts);
      const url = request.nextUrl.clone();
      url.pathname = "/admin" + pathname.slice(adminBase.length);
      return NextResponse.rewrite(url, opts);
    };
    return withAuth(request, adminBase, respond);
  }

  // 伪装生效后，旧 /admin/* 一律 404（包括登录页），避免暴露真实入口
  if (adminPath !== "admin" && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // admin_path = admin：维持原守卫逻辑
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return withAuth(request, "/admin", (opts) => NextResponse.next(opts));
  }

  return NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next|favicon.ico|robots.txt|sitemap.xml).*)"],
};
