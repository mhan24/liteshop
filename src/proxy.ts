import { NextResponse, type NextRequest } from "next/server";
import { normalizeAdminPath, resolveAdminRoute } from "@/lib/admin-path";

/** 后台入口伪装（规则见 lib/admin-path） */
export function proxy(request: NextRequest) {
  // 本项目只使用 App Router；Pages Router 数据地址会在代理之后再次映射为页面。
  if (request.nextUrl.pathname.startsWith("/_next/data/")) return new NextResponse("not found", { status: 404 });
  const decision = resolveAdminRoute(request.nextUrl.pathname, normalizeAdminPath(process.env.ADMIN_PATH));
  if (decision.kind === "pass") return NextResponse.next();
  if (decision.kind === "not-found") return new NextResponse("not found", { status: 404 });
  const url = new URL(request.url);
  url.pathname = decision.to;
  return NextResponse.rewrite(url);
}

export const config = {
  // ADMIN_PATH 是运行时配置，matcher 必须静态：覆盖全部页面路由，只排除 API 与静态资源
  matcher: ["/((?!api(?:/|$)|_next/(?:static|image)(?:/|$)|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$).*)"],
};
