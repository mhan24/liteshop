import { getAdminSession } from "@/server/admin-auth";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { logoutAction } from "@/actions/admin";

/** 后台布局守卫：未登录一律跳登录页（/admin/login，经 ADMIN_PATH 伪装） */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect(`${env.ADMIN_PATH.replace(/\/+$/, "")}/login`);

  async function logout() {
    "use server";
    await logoutAction();
  }

  const base = env.ADMIN_PATH.replace(/\/+$/, "");
  const nav = [
    [base, "概览"],
    [`${base}/orders`, "订单"],
    [`${base}/products`, "商品"],
    [`${base}/cards`, "卡密"],
    [`${base}/payments`, "支付渠道"],
    [`${base}/settings`, "设置"],
  ] as const;

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="font-serif font-semibold">管理后台</span>
          <nav className="flex flex-wrap items-center gap-3 text-sm text-muted">
            {nav.map(([href, label]) => (
              <a key={href} href={href} className="hover:text-fg">
                {label}
              </a>
            ))}
            <form action={logout}>
              <button type="submit" className="text-sm text-muted hover:text-danger">
                退出
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
