import { autoDelivery } from "./auto";
import { manualDelivery } from "./manual";
import type { DeliveryStrategy } from "./strategy";

export { autoDelivery, manualDelivery };
export * from "./strategy";

/** 发货策略分发器：新发货类型在此注册，不改订单主流程（PLAN §6-⑥） */
export function getDeliveryStrategy(type: string): DeliveryStrategy {
  switch (type) {
    case "auto":
      return autoDelivery;
    case "manual":
      return manualDelivery;
    default:
      throw new Error(`未知发货方式: ${type}`);
  }
}
