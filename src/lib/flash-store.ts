import { randomBytes } from "node:crypto";

/**
 * 一次性 Flash 消息（进程内存，TTL 5 分钟）。
 * Action 保存后重定向仅携带随机 ID（?flash=<id>），页面渲染时取走即删——
 * 避免 URL 出现整段编码的中文提示，刷新也不会重复弹出（PRG 模式）。
 * 注：应用为单实例部署（SQLite 单写者约束），内存存储即安全。
 */

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;

const store = new Map<string, { ok?: string; err?: string; at: number }>();

export function putFlash(message: { ok?: string; err?: string }): string {
  // 顺手清理过期项
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.at > TTL_MS) store.delete(k);
  }
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  const id = randomBytes(6).toString("hex");
  store.set(id, { ...message, at: now });
  return id;
}

export function takeFlash(id: string | undefined | null): { ok?: string; err?: string } | null {
  if (!id) return null;
  const v = store.get(id);
  if (!v) return null;
  store.delete(id);
  if (Date.now() - v.at > TTL_MS) return null;
  return { ok: v.ok, err: v.err };
}
