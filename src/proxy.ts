import { NextResponse, type NextRequest } from "next/server";
import { normalizeAdminPath, resolveAdminRoute } from "@/lib/admin-path";

/** 后台入口伪装（规则见 lib/admin-path） */
export function proxy(request: NextRequest) {
  const decision = resolveAdminRoute(request.nextUrl.pathname, normalizeAdminPath(process.env.ADMIN_PATH));
  if (decision.kind === "pass") return NextResponse.next();
  if (decision.kind === "not-found") return new NextResponse("not found", { status: 404 });
  const url = request.nextUrl.clone();
  url.pathname = decision.to;
  return NextResponse.rewrite(url);
}

export const config = {
  // ADMIN_PATH 是运行时配置，matcher 必须静态：覆盖全部页面路由，只排除 API 与静态资源
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
