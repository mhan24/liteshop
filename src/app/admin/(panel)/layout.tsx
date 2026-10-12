import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { getSiteName } from "@/server/settings";
import { logoutAction } from "@/actions/admin";
import { ADMIN_COOKIE } from "@/lib/session";
import { getAdminBase } from "@/lib/admin-path";
import { AdminNav } from "@/components/admin/admin-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutIcon } from "@phosphor-icons/react/ssr";

export const dynamic = "force-dynamic";

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const session = await currentSession(jar.get(ADMIN_COOKIE)?.value);
  if (!session) redirect("/admin/login");
  const siteName = getSiteName();
  const base = await getAdminBase();

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="mx-auto flex max-w-6xl flex-col md:flex-row">
        {/* 侧边栏（桌面） */}
        <aside className="hidden md:flex w-48 shrink-0 flex-col border-r border-border bg-sidebar px-3 py-6 md:min-h-[100dvh] md:sticky md:top-0">
          <Link href={base} className="mb-8 px-2 font-serif text-xl tracking-tight">
            {siteName}
          </Link>
          <AdminNav base={base} variant="sidebar" />
          <div className="mt-auto flex items-center gap-1 pt-6">
            <ThemeToggle />
            <form action={logoutAction} className="flex-1">
              <button
                type="submit"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <SignOutIcon className="size-4" weight="bold" />
                退出登录
              </button>
            </form>
          </div>
        </aside>

        {/* 顶导航（移动） */}
        <header className="border-b border-border bg-sidebar px-4 py-3 md:hidden">
          <div className="flex items-center justify-between">
            <Link href={base} className="font-serif text-lg tracking-tight">
              {siteName}
            </Link>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <form action={logoutAction}>
                <button type="submit" aria-label="退出登录">
                  <SignOutIcon className="size-5 text-muted-foreground" weight="bold" />
                </button>
              </form>
            </div>
          </div>
          <div className="mt-2">
            <AdminNav base={base} variant="topbar" />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-8 md:px-8 md:py-10">{children}</main>
      </div>
    </div>
  );
}
