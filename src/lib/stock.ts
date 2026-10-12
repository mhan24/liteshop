/**
 * manual 商品库存语义（唯一真相）。
 *
 * 历史缺陷：`stock_limit = 0` 同时被当作「不限库存」和「已售罄」，
 * 而扣减逻辑又依赖 `stockLimit > 0` 才执行条件扣减。于是库存在扣到 0 之后
 * 便**彻底失去约束**——下一单会被当作"不限库存"放行，造成超卖。
 *
 * 统一约定：
 * - `UNLIMITED (-1)`：不限库存，永不扣减、永不售罄
 * - `>= 0`：剩余可售数量，`0` 明确表示售罄
 */

/** 不限库存的哨兵值 */
export const STOCK_UNLIMITED = -1;

/** 是否为「不限库存」 */
export function isUnlimitedStock(stockLimit: number): boolean {
  return stockLimit < 0;
}

/** 是否需要执行条件扣减（仅有限库存且仍有余额时参与扣减） */
export function shouldChargeStock(stockLimit: number): boolean {
  return !isUnlimitedStock(stockLimit);
}

/**
 * 对外展示的库存：
 * - 不限 → null（前端显示"充足/不限"）
 * - 有限 → 具体剩余数（0 表示售罄）
 */
export function visibleStock(stockLimit: number): number | null {
  return isUnlimitedStock(stockLimit) ? null : stockLimit;
}

/** 是否可售（auto 型由卡池决定，不走此函数） */
export function isOnSaleByStock(stockLimit: number): boolean {
  return isUnlimitedStock(stockLimit) || stockLimit > 0;
}

/**
 * 归一化外部输入：
 * - 空/空白/null/undefined/NaN/负数 → 不限（-1）
 * - 其它 → 截断为非负整数（0 保留，表示售罄）
 *
 * 注意：不能直接 Number(input)——`Number("")` 与 `Number(null)` 都是 0，
 * 会把"表单留空"误判为"售罄"（这正是历史上 0 语义冲突的翻版）。
 */
export function normalizeStockLimit(input: unknown): number {
  if (input === null || input === undefined) return STOCK_UNLIMITED;
  if (typeof input === "string" && input.trim() === "") return STOCK_UNLIMITED;
  const n = Math.trunc(Number(input));
  if (!Number.isFinite(n) || n < 0) return STOCK_UNLIMITED;
  return n;
}
