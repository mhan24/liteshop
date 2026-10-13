import type { OrderStatus } from "@/db/schema";

/**
 * 订单状态机（PLAN §9：所有订单状态变化必须经过状态机校验）。
 * pending --支付成功--> paid --自动发货中--> delivering --交付--> completed
 */
const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["paid", "expired", "closed", "reconciling"],
  // reconciling：结果未知。经确认网关未建单 → closed（此时才释放库存）；
  // 若确认已建单且到账 → paid（正常履约）。不允许直接 expired，
  // 避免「只因为本地倒计时结束」就释放可能已在网关生效的库存。
  reconciling: ["closed", "paid"],
  paid: ["delivering", "completed", "closed"],
  delivering: ["completed", "closed"],
  completed: [],
  // expired：**历史态**。超时的终态现为 closed（见 expire-orders），
  // 但旧数据里可能存在 expired 行，且「迟到到账」分支同时接受
  // expired 与 closed，因此保留该状态与其流转。
  expired: ["closed"],
  closed: [],
};

export class StateTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`非法状态流转: ${from} → ${to}`);
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true; // 幂等重入
  return ALLOWED[from].includes(to);
}

/** 校验失败抛错（事务内抛出即回滚） */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new StateTransitionError(from, to);
}
