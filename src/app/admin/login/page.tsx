import type { Metadata } from "next";
import { env } from "@/lib/env";
import { LoginForm } from "@/components/admin/login-form";
import { ThemeSelect } from "@/components/ui/theme-select";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "管理后台登录", robots: { index: false, follow: false } };

export default function AdminLoginPage() {
  return (
    <div className="relative grid min-h-screen place-items-center px-4">
      <div aria-hidden className="hero-backdrop pointer-events-none absolute inset-x-0 top-0 h-96" />
      <div className="absolute top-3 right-4 z-10 sm:right-6">
        <ThemeSelect />
      </div>
      <div className="relative w-full max-w-sm space-y-6">
        <div className="space-y-3 text-center">
          <span aria-hidden className="data mx-auto grid size-9 place-items-center rounded-sm border border-accent/40 bg-accent/10 text-sm text-accent">
            A
          </span>
          <h1 className="text-xl font-semibold tracking-tight">管理后台登录</h1>
          <p className="text-[13px] text-faint">连续失败 5 次将锁定 15 分钟</p>
        </div>
        <LoginForm adminPath={env.ADMIN_PATH} />
      </div>
    </div>
  );
}
