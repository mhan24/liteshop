import { cn } from "@/lib/cn";

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  return (
    <p
      role="status"
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        err ? "border-red-200 bg-red-50 text-danger" : "border-emerald-200 bg-emerald-50 text-success"
      )}
    >
      {err ?? ok}
    </p>
  );
}
