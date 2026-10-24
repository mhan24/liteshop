import type { Metadata } from "next";
import { env } from "@/lib/env";
import { LoginForm } from "@/components/admin/login-form";

export const metadata: Metadata = { title: "管理登录", robots: { index: false, follow: false } };

export default function AdminLoginPage() {
  return (
    <div className="mx-auto max-w-sm space-y-6 py-16">
      <h1 className="text-center font-serif text-2xl font-semibold tracking-tight">管理登录</h1>
      <LoginForm adminPath={env.ADMIN_PATH.replace(/\/+$/, "")} />
    </div>
  );
}
