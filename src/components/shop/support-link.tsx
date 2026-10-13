import type { ReactNode } from "react";

/**
 * 「联系客服」入口。
 *
 * 纯展示组件：地址由服务端读取设置后以 prop 传入
 * （客户端组件无法调用服务端 getter）。url 为空时不渲染任何内容，
 * 因此调用方无需自行判断是否配置。
 */
export function SupportLink({
  url,
  label,
  className,
}: {
  url: string | null | undefined;
  label: ReactNode;
  className?: string;
}) {
  if (!url) return null;
  return (
    <a
      href={url}
      // 新窗口打开：客服入口常出现在订单页，跳走会打断买家的支付/查单流程
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "font-medium underline underline-offset-4 transition-colors hover:text-foreground"
      }
    >
      {label}
    </a>
  );
}
