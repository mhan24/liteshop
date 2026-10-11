import type { DeliveryType } from "@/db/schema";
import type { DbTransaction } from "@/db";

/**
 * DeliveryStrategy 接口（PLAN §9）：所有发货方式必须实现本接口。
 * fulfill/release 均在 IMMEDIATE 事务内执行，任何异常回滚整个事务。
 */

export interface OrderLike {
  orderNo: string;
  quantity: number;
  deliveryContent: string | null;
  status: string;
  /** manual 型下单时是否扣减过库存（release 回补依据） */
  stockCharged: boolean;
}

export interface ProductLike {
  id: number;
  deliveryType: string;
  stockLimit: number;
}

export interface DeliveryOutcome {
  ok: boolean;
  /** 交付内容（卡密多张以换行分隔）；manual 策略返回 null 表示等待人工录入 */
  content: string | null;
  reason?: string;
}

export interface DeliveryStrategy {
  readonly type: DeliveryType;
  /** 支付确认后执行（事务内）：占卡/校验，成功返回交付内容 */
  fulfill(tx: DbTransaction, order: OrderLike, product: ProductLike): DeliveryOutcome;
  /** 订单关闭/过期时回滚占用（事务内）：释放 reserved 卡密或回补 manual 库存 */
  release(tx: DbTransaction, order: OrderLike, product: ProductLike): void;
}
