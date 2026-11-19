import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/*
 * 按钮（DESIGN.md §4）：高 40px、6px 圆角、无阴影，按下轻微收缩。
 * default = 信号青主操作（每个视图区最多一个）；danger 用红色淡底而非实底。
 */
const buttonVariants = cva(
  "inline-flex h-10 items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium transition-[background-color,border-color,color,transform,opacity] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:bg-accent-hover",
        outline: "border border-line-strong bg-surface-2 text-fg hover:bg-surface-3",
        ghost: "text-muted hover:bg-surface-2 hover:text-fg",
        danger: "border border-tint-red-fg/30 bg-tint-red text-tint-red-fg hover:bg-tint-red-fg/15",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export function Button({
  className,
  variant,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />;
}

export { buttonVariants };
