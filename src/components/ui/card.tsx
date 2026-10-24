import { cn } from "@/lib/cn";

/*
 * 卡片：纯白面、1px #EAEAEA 边框、12px 圆角、无阴影。
 * 交互态阴影由调用方按需添加（如商品卡 hover）。
 */
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-surface",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("space-y-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("font-serif text-lg font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm leading-6 text-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}
