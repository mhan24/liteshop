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

export interface ReleaseOutcome {
  /**
   * 本次调用是否真的发生了回滚（释放了卡密或回补了库存）。
   *
   * 调用方**必须**在返回 true 时于**同一事务内**清除订单的占用标志
   * （stockCharged），否则同一订单被多次释放会重复回补库存。
   * 历史缺陷：释放只读 stockCharged 却从不清除它，
   * 于是「超时清扫释放一次 + 管理员关闭再释放一次」使库存凭空增加。
   */
  released: boolean;
  /** 回补的库存数量（manual 型有效） */
  restoredQuantity?: number;
}

export interface DeliveryStrategy {
  readonly type: DeliveryType;
  /** 支付确认后执行（事务内）：占卡/校验，成功返回交付内容 */
  fulfill(tx: DbTransaction, order: OrderLike, product: ProductLike): DeliveryOutcome;
  /**
   * 订单关闭/过期时回滚占用（事务内）：释放 reserved 卡密或回补 manual 库存。
   * 必须是**幂等**的：已释放过的订单再次调用应返回 released=false 且不改动库存。
   */
  release(tx: DbTransaction, order: OrderLike, product: ProductLike): ReleaseOutcome;
}
