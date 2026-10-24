"use client";

import { Flash as FlashView } from "./flash-view";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/** 后台通用反馈条（客户端/服务端共用展示） */
export function Flash({ ok, err }: { ok?: string; err?: string }) {
  return <FlashView ok={ok} err={err} />;
}

/**
 * 后台通用表单壳：useActionState + 内联结果 + 单一提交按钮。
 * 所有后台 Server Action 统一 (prev, formData) => {ok, message} 签名。
 */
export function AdminForm<S extends { ok: boolean; message: string }>({
  action,
  csrf,
  children,
  submitLabel,
  pendingLabel = "处理中…",
  className,
  footer,
}: {
  action: (prev: S | null, formData: FormData) => Promise<S>;
  csrf: string;
  children: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  footer?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<S | null, FormData>(action, null);
  return (
    <form action={formAction} className={cn("space-y-4", className)}>
      <input type="hidden" name="csrf" value={csrf} />
      {children}
      {state ? <Flash ok={state.ok ? state.message : undefined} err={state.ok ? undefined : state.message} /> : null}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {footer}
      </div>
    </form>
  );
}
