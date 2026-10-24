import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/*
 * 主按钮炭黑实底（#111），hover #333，按下轻微收缩；
 * 全部直角小圆角（6px），无阴影。
 */
const buttonVariants = cva(
  "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-[background-color,border-color,color,transform,opacity] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:bg-accent-hover",
        outline: "border border-line bg-transparent hover:bg-surface-2",
        ghost: "text-muted hover:bg-surface-2 hover:text-fg",
        danger: "bg-danger text-white hover:bg-danger/90",
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
