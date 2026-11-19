"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/** 后台导航：当前页信号青下划线高亮（浏览器地址即伪装后的 ADMIN_PATH，与 href 同口径） */
export function AdminNav({ items }: { items: ReadonlyArray<readonly [string, string]> }) {
  const pathname = usePathname();
  const base = items[0]?.[0] ?? "";
  return (
    <nav className="-mb-px flex items-center gap-1 overflow-x-auto text-sm">
      {items.map(([href, label]) => {
        const active = href === base ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-3 transition-colors",
              active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
