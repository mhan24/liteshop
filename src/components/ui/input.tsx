import { cn } from "@/lib/cn";

const fieldClasses =
  "flex h-10 w-full rounded-md border border-line bg-surface px-3 text-sm placeholder:text-muted/60 focus:border-fg disabled:opacity-50";

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
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(fieldClasses, "pr-8", className)} {...props} />;
}

/*
 * 徽章：全圆角 pill + 低饱和粉彩底 + 同系深色文字，小号宽字距。
 * neutral 用于中性信息，其余按语义选择 tint。
 */
const badgeTones = {
  neutral: "border-line bg-surface-2 text-muted",
  green: "border-tint-green-fg/25 bg-tint-green text-tint-green-fg",
  yellow: "border-tint-yellow-fg/25 bg-tint-yellow text-tint-yellow-fg",
  blue: "border-tint-blue-fg/25 bg-tint-blue text-tint-blue-fg",
  red: "border-tint-red-fg/25 bg-tint-red text-tint-red-fg",
} as const;

type BadgeTone = keyof typeof badgeTones;

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs tracking-wide",
        badgeTones[tone],
        className
      )}
      {...props}
    />
  );
}
