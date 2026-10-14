"use client";

import { useState } from "react";

/**
 * 收款信息字段：值 + 一键复制。
 *
 * 交易所转账场景下买家要反复粘贴地址/备注，复制按钮是必需的；
 * 复制失败（非安全上下文、权限被拒）时回退为「已选中文本」提示，
 * 避免买家以为按钮无效。
 */
export function CopyField({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  /** 收款地址等关键字段用更大字号与等宽字体 */
  emphasis?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 1600);
    } catch {
      setState("failed");
      setTimeout(() => setState("idle"), 2600);
    }
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent"
        >
          {state === "copied" ? "已复制" : state === "failed" ? "请长按选择" : "复制"}
        </button>
      </div>
      <code
        className={
          "block break-all font-mono " +
          (emphasis ? "text-base font-semibold leading-relaxed" : "text-sm")
        }
      >
        {value}
      </code>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
