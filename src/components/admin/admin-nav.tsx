"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowSquareOutIcon,
  GearSixIcon,
  SquaresFourIcon,
  TicketIcon,
  PackageIcon,
  ReceiptIcon,
} from "@phosphor-icons/react/ssr";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { path: "/admin", label: "仪表盘", icon: SquaresFourIcon, exact: true },
  { path: "/admin/products", label: "商品", icon: PackageIcon },
  { path: "/admin/cards", label: "卡密", icon: TicketIcon },
  { path: "/admin/orders", label: "订单", icon: ReceiptIcon },
  { path: "/admin/settings", label: "设置", icon: GearSixIcon },
];

/**
 * 后台导航（客户端组件：图标引用留在客户端侧，避免跨序列化边界传组件）。
 * base 由服务端传入（/admin 或伪装入口路径），保证改路径后链接仍然有效。
 */
export function AdminNav({ base, variant }: { base: string; variant: "sidebar" | "topbar" }) {
  const pathname = usePathname();
  return (
    <nav
      className={cn(
        variant === "sidebar" ? "flex flex-col gap-0.5" : "flex gap-1 overflow-x-auto pb-1"
      )}
    >
      {NAV_ITEMS.map((item) => {
        const href = base === "/admin" ? item.path : base + item.path.slice("/admin".length);
        const active = item.exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={item.path}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-foreground",
              active ? "bg-accent font-medium text-foreground" : "text-muted-foreground",
              variant === "topbar" && "whitespace-nowrap"
            )}
          >
            <item.icon className="size-4" weight="bold" />
            {item.label}
          </Link>
        );
      })}
      <a
        href="/"
        target="_blank"
        rel="noreferrer"
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          variant === "topbar" && "whitespace-nowrap"
        )}
      >
        <ArrowSquareOutIcon className="size-4" weight="bold" />
        前往前台
      </a>
    </nav>
  );
}
