import { cn } from "@/lib/cn";

/* 输入框（DESIGN.md §4）：surface-2 底、line-strong 边；focus 信号青边 + 3px 外环 */
const fieldClasses =
  "flex h-10 w-full rounded-sm border border-line-strong bg-surface-2 px-3 text-sm text-fg outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-faint focus:border-accent focus:ring-[3px] focus:ring-accent/20 aria-[invalid=true]:border-tint-red-fg disabled:opacity-50";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(fieldClasses, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(fieldClasses, "h-auto min-h-20 py-2 leading-6", className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-[13px] font-medium text-muted", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(fieldClasses, "pr-8", className)} {...props} />;
}

/*
 * 徽章（DESIGN.md §4）：全圆角 + 10% 淡底 + 同系浅色字 + 同系 25% 边框。
 * live 为真时带圆点前缀（有货、待支付等「活」状态）。
 */
const badgeTones = {
  neutral: "border-line-strong bg-surface-2 text-muted",
  green: "border-tint-green-fg/25 bg-tint-green text-tint-green-fg",
  yellow: "border-tint-yellow-fg/25 bg-tint-yellow text-tint-yellow-fg",
  blue: "border-tint-blue-fg/25 bg-tint-blue text-tint-blue-fg",
  red: "border-tint-red-fg/25 bg-tint-red text-tint-red-fg",
} as const;

type BadgeTone = keyof typeof badgeTones;

export function Badge({
  className,
  tone = "neutral",
  live = false,
  children,
  ...props
}: React.ComponentProps<"span"> & { tone?: BadgeTone; live?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap",
        badgeTones[tone],
        className
      )}
      {...props}
    >
      {live ? <span aria-hidden className="live-dot" /> : null}
      {children}
    </span>
  );
}
