import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg hover:opacity-90",
        outline: "border border-line bg-transparent hover:bg-bg",
        ghost: "hover:bg-bg",
        danger: "bg-danger text-white hover:opacity-90",
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
