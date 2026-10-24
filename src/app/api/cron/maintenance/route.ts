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
  if (!env.CRON_SECRET) return new Response("forbidden", { status: 403 });
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== env.CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  if (!rateLimit(`cron:${url.searchParams.get("key")}`, 10, 60_000).ok) {
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
