import type { OrderStatus } from "@/db/schema";

/**
 * 订单状态机（PLAN §9：所有订单状态变化必须经过状态机校验）。
 * pending --支付成功--> paid --自动发货中--> delivering --交付--> completed
 */
const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["paid", "expired", "closed"],
  paid: ["delivering", "completed", "closed"],
  delivering: ["completed", "closed"],
  completed: [],
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
