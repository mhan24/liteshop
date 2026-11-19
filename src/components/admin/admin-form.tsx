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
 *
 * variant：主操作用 default（每个区块一个），危险操作用 danger，其余 outline。
 * confirmText：不可撤销的操作（删除、关单、人工确认到账）提交前二次确认。
 */
export function AdminForm<S extends { ok: boolean; message: string }>({
  action,
  csrf,
  children,
  submitLabel,
  pendingLabel = "处理中…",
  className,
  footer,
  variant = "default",
  confirmText,
  inline = false,
}: {
  action: (prev: S | null, formData: FormData) => Promise<S>;
  csrf: string;
  children: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  footer?: React.ReactNode;
  variant?: "default" | "outline" | "danger" | "ghost";
  confirmText?: string;
  /** 行内操作（列表里的删除等）：按钮收紧、结果提示紧跟按钮 */
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState<S | null, FormData>(action, null);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
      className={cn(inline ? "flex flex-wrap items-center gap-2" : "space-y-4", className)}
    >
      <input type="hidden" name="csrf" value={csrf} />
      {children}
      {state && !inline ? (
        <Flash ok={state.ok ? state.message : undefined} err={state.ok ? undefined : state.message} />
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" variant={variant} disabled={pending} className={inline ? "h-8 px-3 text-xs" : undefined}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {footer}
      </div>
      {state && inline ? (
        <span className={cn("text-xs", state.ok ? "text-tint-green-fg" : "text-tint-red-fg")}>{state.message}</span>
      ) : null}
    </form>
  );
}
