import { cn } from "@/lib/utils";

export type OrderStatusKey =
  | "pending"
  | "reconciling"
  | "paid"
  | "delivering"
  | "completed"
  | "expired"
  | "closed";

const STYLES: Record<OrderStatusKey, string> = {
  pending: "bg-pastel-yellow-bg text-pastel-yellow-text",
  // 待对账属异常态，用醒目色提示需要人工核对网关
  reconciling: "bg-pastel-red-bg text-pastel-red-text",
  paid: "bg-pastel-blue-bg text-pastel-blue-text",
  delivering: "bg-pastel-blue-bg text-pastel-blue-text",
  completed: "bg-pastel-green-bg text-pastel-green-text",
  expired: "bg-pastel-red-bg text-pastel-red-text",
  closed: "bg-accent text-muted-foreground",
};

const LABELS: Record<OrderStatusKey, string> = {
  pending: "待支付",
  reconciling: "待对账",
  paid: "待处理",
  delivering: "发货中",
  completed: "已完成",
  expired: "已超时",
  closed: "已关闭",
};

/** 状态徽章（taste-skill：药丸、text-xs、大写间距、粉彩底） */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const key = (LABELS[status as OrderStatusKey] ? status : "closed") as OrderStatusKey;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs tracking-[0.05em] uppercase whitespace-nowrap",
        STYLES[key]
      )}
    >
      {label ?? LABELS[key]}
    </span>
  );
}
