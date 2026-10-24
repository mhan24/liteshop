import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { paymentChannels } from "@/db/schema";
import { decryptSecret } from "@/lib/secret-box";
import { env } from "@/lib/env";
import type { ChannelRuntime, PaymentAdapter } from "./types";
import { epusdtAdapter } from "./epusdt";
import { mockAdapter } from "./mock";

/**
 * 渠道注册表。
 *
 * - 商城启用 BEpusdt 兼容收银台渠道（pay.9527.tr / 自建 BEpusdt 等，多实例）
 * - 旧「交易所直连轮询」渠道已被 LitePay 收银台取代，不再保留（业务决策，见 PLAN）
 * - PAYMENT_DRIVER=mock 时提供内置 mock 渠道（仅开发/测试）
 */

export const DEV_MOCK_CHANNEL: ChannelRuntime = {
  id: -1,
  key: "mock",
  type: "mock",
  displayName: "模拟支付（开发）",
  apiBase: null,
  token: "mock-token",
  currencies: null,
  timeoutSeconds: 1800,
  reselect: false,
};

function toRuntime(row: typeof paymentChannels.$inferSelect): ChannelRuntime | null {
  if (row.type === "mock") {
    return { ...DEV_MOCK_CHANNEL, id: row.id, key: row.key, displayName: row.displayName };
  }
  const token = row.tokenEnc ? decryptSecret(row.tokenEnc) : null;
  return {
    id: row.id,
    key: row.key,
    type: "epusdt",
    displayName: row.displayName,
    apiBase: row.apiBase,
    token,
    currencies: row.currencies,
    timeoutSeconds: row.timeoutSeconds,
    reselect: row.reselect,
  };
}

/** 前台可选渠道（enabled，按 sortOrder 升序、id 次序） */
export async function listEnabledChannels(): Promise<ChannelRuntime[]> {
  if (env.PAYMENT_DRIVER === "mock") {
    const dbMock = await loadDbMockChannel();
    return [dbMock ?? DEV_MOCK_CHANNEL];
  }
  const rows = await db
    .select()
    .from(paymentChannels)
    .where(eq(paymentChannels.enabled, true))
    .orderBy(asc(paymentChannels.sortOrder), asc(paymentChannels.id));
  const out: ChannelRuntime[] = [];
  for (const row of rows) {
    const rt = toRuntime(row);
    if (rt && (rt.type !== "epusdt" || (rt.apiBase && rt.token))) out.push(rt);
  }
  return out;
}

/** mock 模式下优先用数据库中的 mock 渠道行（payments.channel_id 外键需要真实 id） */
async function loadDbMockChannel(): Promise<ChannelRuntime | null> {
  const rows = await db
    .select()
    .from(paymentChannels)
    .where(eq(paymentChannels.key, "mock"))
    .limit(1);
  const row = rows[0];
  if (!row || !row.enabled) return null;
  const rt = toRuntime(row);
  return rt ?? null;
}

export async function getChannelByKey(key: string): Promise<ChannelRuntime | null> {
  if (env.PAYMENT_DRIVER === "mock" && key === "mock") {
    return (await loadDbMockChannel()) ?? DEV_MOCK_CHANNEL;
  }
  const rows = await db.select().from(paymentChannels).where(eq(paymentChannels.key, key)).limit(1);
  const row = rows[0];
  if (!row || !row.enabled) return null;
  return toRuntime(row);
}

export async function getChannelById(id: number): Promise<ChannelRuntime | null> {
  const rows = await db.select().from(paymentChannels).where(eq(paymentChannels.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return toRuntime(row);
}

export function getAdapter(type: ChannelRuntime["type"]): PaymentAdapter {
  return type === "mock" ? mockAdapter : epusdtAdapter;
}

/** 当前默认渠道（前台不选择时），与展示顺序一致 */
export async function getDefaultChannel(): Promise<ChannelRuntime | null> {
  const channels = await listEnabledChannels();
  return channels[0] ?? null;
}

/** 后台渠道列表（含停用） */
export async function listAllChannels() {
  return db.select().from(paymentChannels).orderBy(asc(paymentChannels.sortOrder), asc(paymentChannels.id));
}

export async function findChannelRowByKey(key: string) {
  const rows = await db
    .select()
    .from(paymentChannels)
    .where(and(eq(paymentChannels.key, key), eq(paymentChannels.enabled, true)))
    .limit(1);
  return rows[0] ?? null;
}
