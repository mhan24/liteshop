import { getAdminSession } from "@/server/admin-auth";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { logoutAction } from "@/actions/admin";
import { AdminNav } from "@/components/admin/admin-nav";

/** 后台布局守卫：未登录一律跳登录页（/admin/login，经 ADMIN_PATH 伪装） */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect(`${env.ADMIN_PATH}/login`);

  async function logout() {
    "use server";
    await logoutAction();
  }

  const base = env.ADMIN_PATH;
  const nav = [
    [base, "概览"],
    [`${base}/orders`, "订单"],
    [`${base}/products`, "商品"],
    [`${base}/cards`, "卡密"],
    [`${base}/settings`, "设置"],
  ] as const;

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-5">
            <span className="flex shrink-0 items-center gap-2 py-3 text-sm font-semibold">
              <span aria-hidden className="data grid size-6 place-items-center rounded-sm border border-accent/40 bg-accent/10 text-[11px] text-accent">
                A
              </span>
              管理后台
            </span>
            <AdminNav items={nav} />
          </div>
          <div className="flex shrink-0 items-center gap-4 text-xs text-faint">
            <span className="data hidden sm:inline">{session.username}</span>
            <form action={logout}>
              <button type="submit" className="text-sm text-muted transition-colors hover:text-tint-red-fg">
                退出
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
