import { requireAdminPageSession } from "@/server/admin-auth";
import { env } from "@/lib/env";
import { logoutAction } from "@/actions/admin";
import { AdminNav } from "@/components/admin/admin-nav";
import { ThemeSelect } from "@/components/ui/theme-select";

/** 后台布局守卫：未登录一律跳登录页（/admin/login，经 ADMIN_PATH 伪装） */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdminPageSession();

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
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 px-4 sm:flex-nowrap sm:px-6">
          <div className="contents sm:flex sm:min-w-0 sm:items-center sm:gap-5">
            <span className="flex shrink-0 items-center gap-2 py-3 text-sm font-semibold">
              <span aria-hidden className="data grid size-6 place-items-center rounded-sm border border-accent/40 bg-accent/10 text-[11px] text-accent">
                A
              </span>
              管理后台
            </span>
            <div className="order-last w-full min-w-0 sm:order-none sm:w-auto">
              <AdminNav items={nav} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-4 text-xs text-faint">
            <span className="data hidden sm:inline">{session.username}</span>
            <ThemeSelect />
            <form action={logout}>
              <button type="submit" className="text-sm text-muted transition-colors hover:text-tint-red-fg">
                退出登录
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
