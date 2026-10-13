import { getSetting, setSetting } from "@/server/settings";

/**
 * 前台文案注册表：所有可后台修改的前台文本。
 * 存储键 = copy_<key>；未设置时回退默认值。新增文案在此登记即可后台编辑。
 */

export const COPY_DEFAULTS = {
  /** 首页眉标 */
  hero_badge: "数字商品 · 支付后自动发货",
  /** 首页主标题（支持换行） */
  hero_title: "挑选商品，\n卡密秒到。",
  /** 首页副标题 */
  hero_desc: "下单后跳转收银台使用 USDT 等加密货币支付，到账即自动发放卡密；人工商品由客服快速处理。",
  /** 商品列表空状态 */
  shop_empty_title: "商品上架中",
  shop_empty_desc: "敬请期待",
  /** 购买按钮 */
  buy_button: "立即购买",
  /** 购买须知 */
  buy_notice: "点击购买即同意：数字商品一经交付，非质量问题不支持退款",
  /** 详情页支付提示 */
  detail_pay_hint: "支付完成后回到本站，凭「订单号 + 邮箱」在「订单查询」页查看卡密或交付内容。",
  /** 查单页 */
  lookup_title: "订单查询",
  lookup_desc: "凭下单时填写的邮箱与订单号，查看支付状态与卡密 / 交付内容",
  /** 待支付页脚注 */
  pending_hint: "支付完成后凭「订单号 + 邮箱」在「订单查询」页查看卡密或交付内容。本页可收藏，随时回来查看支付状态。",
  /** 页脚右侧 */
  footer_powered: "Powered by liteshop",
  /** 联系客服入口文案 */
  support_label: "联系客服",
} as const;

export type CopyKey = keyof typeof COPY_DEFAULTS;

export const COPY_KEYS = Object.keys(COPY_DEFAULTS) as CopyKey[];

/** 单条文案：settings 优先，回落默认 */
export function getCopy(key: CopyKey): string {
  const v = getSetting(`copy_${key}`);
  return v !== null && v.trim() !== "" ? v : COPY_DEFAULTS[key];
}

/** 批量读取（一页内多次调用合并为一次查询） */
export function getCopyAll(): Record<CopyKey, string> {
  const out = {} as Record<CopyKey, string>;
  for (const key of COPY_KEYS) out[key] = getCopy(key);
  return out;
}

export function setCopy(key: CopyKey, value: string): void {
  setSetting(`copy_${key}`, value);
}

/** 后台编辑字段元数据 */
export const COPY_FIELDS: { key: CopyKey; label: string; multiline?: boolean }[] = [
  { key: "hero_badge", label: "首页 · 眉标" },
  { key: "hero_title", label: "首页 · 主标题（支持换行）", multiline: true },
  { key: "hero_desc", label: "首页 · 副标题", multiline: true },
  { key: "shop_empty_title", label: "商品列表 · 空状态标题" },
  { key: "shop_empty_desc", label: "商品列表 · 空状态副文案" },
  { key: "buy_button", label: "购买按钮文字" },
  { key: "buy_notice", label: "购买须知", multiline: true },
  { key: "detail_pay_hint", label: "详情页 · 支付提示", multiline: true },
  { key: "lookup_title", label: "查单页 · 标题" },
  { key: "lookup_desc", label: "查单页 · 副标题", multiline: true },
  { key: "pending_hint", label: "待支付页 · 脚注", multiline: true },
  { key: "footer_powered", label: "页脚 · 右侧文案" },
  { key: "support_label", label: "联系客服 · 入口文案" },
];
