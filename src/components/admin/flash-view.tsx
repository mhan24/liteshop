import { cn } from "@/lib/cn";

/** 操作结果提示：粉彩 tint 底 + 同系深色文字（错误红 / 成功绿） */
export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  return (
    <p
      role="status"
      className={cn(
        "rounded-lg border px-3 py-2 text-sm leading-6",
        err
          ? "border-tint-red-fg/25 bg-tint-red text-tint-red-fg"
          : "border-tint-green-fg/25 bg-tint-green text-tint-green-fg"
      )}
    >
      {err ?? ok}
    </p>
  );
}
