import { NextResponse, type NextRequest } from "next/server";

/**
 * 后台入口伪装：仅允许通过 ADMIN_PATH（默认 /admin）访问后台；
 * 其它请求原样放行。直接访问 /admin（当 ADMIN_PATH 改为其它值时）返回 404，
 * 防止扫描器发现后台入口。
 */
export function proxy(request: NextRequest) {
  const adminPath = (process.env.ADMIN_PATH ?? "/admin").replace(/\/+$/, "") || "/admin";
  const { pathname } = request.nextUrl;

  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  if (!isAdminRoute) return NextResponse.next();

  if (adminPath !== "/admin" && (pathname === adminPath || pathname.startsWith(`${adminPath}/`))) {
    return NextResponse.rewrite(new URL(pathname.slice(adminPath.length) || "/admin", request.url));
  }
  if (adminPath === "/admin") return NextResponse.next();
  return new NextResponse("not found", { status: 404 });
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/manage", "/manage/:path*", "/console", "/console/:path*"],
};
