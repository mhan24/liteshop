"use client";

import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "@phosphor-icons/react/ssr";
import { cn } from "@/lib/utils";

/**
 * 深浅主题切换：默认跟随系统（next-themes system），点击在浅色/深色间切换。
 * 图标用 CSS 按 .dark 类切换显示，规避 SSR 水合不一致。
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      aria-label="切换深色/浅色主题"
      title="切换深色/浅色主题"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className
      )}
    >
      <SunIcon className="hidden size-4 dark:block" weight="bold" />
      <MoonIcon className="size-4 dark:hidden" weight="bold" />
    </button>
  );
}
