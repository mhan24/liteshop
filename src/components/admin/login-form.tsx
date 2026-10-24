"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { loginAction } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Flash } from "@/components/admin/flash-view";

export function LoginForm({ adminPath }: { adminPath: string }) {
  const [state, formAction, pending] = useActionState(loginAction, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok) router.replace(adminPath === "/admin" ? "/admin" : adminPath);
  }, [state?.ok, router, adminPath]);

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-line bg-surface p-6">
      <div className="space-y-1.5">
        <Label htmlFor="login-user">用户名</Label>
        <Input id="login-user" name="username" required autoComplete="username" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="login-pass">密码</Label>
        <Input id="login-pass" name="password" type="password" required autoComplete="current-password" />
      </div>
      {state && !state.ok ? <Flash err={state.message} /> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "登录中…" : "登录"}
      </Button>
    </form>
  );
}
