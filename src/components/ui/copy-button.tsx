"use client";

import { useState } from "react";
import { Button } from "./button";

/** 复制按钮：成功显示「已复制」2 秒；剪贴板不可用（非 HTTPS 等）时提示手动选择 */
export function CopyButton({
  text,
  label = "复制",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <Button type="button" variant="outline" onClick={copy} className={className} aria-live="polite">
      {state === "done" ? "✓ 已复制" : state === "failed" ? "复制失败，请手动选择" : label}
    </Button>
  );
}
