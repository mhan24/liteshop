import { createHash, timingSafeEqual } from "node:crypto";
import { sweepExpired } from "@/server/orders";
import { flushDeliveryEmails } from "@/server/mail";
import { db } from "@/db";
import { notifyLogs } from "@/db/schema";
import { lt } from "drizzle-orm";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * 维护任务（外部定时器调用，如 compose 内 cron 服务每分钟）：
 * - 过期订单清扫（释放库存 + 通知网关撤销）
 * - 交付邮件重投
 * - 回调日志保留 30 天
 */
export async function POST(request: Request) {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return new Response("forbidden", { status: 403 });
  }
  if (!rateLimit("cron", 10, 60_000).ok) {
    return new Response("too many", { status: 429 });
  }

  const sweep = await sweepExpired();
  const mail = await flushDeliveryEmails(50);
  const cutoff = new Date(Date.now() - 30 * 86400_000);
  await db.delete(notifyLogs).where(lt(notifyLogs.createdAt, cutoff));

  return Response.json({
    ok: true,
    closedOrders: sweep.closedOrders,
    emailSent: mail.sent,
    emailFailed: mail.failed,
  });
}

/** Authorization: Bearer <CRON_SECRET>（不走 query：密钥会进访问日志）；常量时间比较 */
function isAuthorized(header: string | null): boolean {
  if (!env.CRON_SECRET || !header?.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(header.slice(7)).digest();
  const expected = createHash("sha256").update(env.CRON_SECRET).digest();
  return timingSafeEqual(given, expected);
}
