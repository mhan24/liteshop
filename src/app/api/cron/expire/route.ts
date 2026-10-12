import { timingSafeEqual } from "node:crypto";
import { sweepExpiredOrders, countOverduePending, purgeOldLogs } from "@/server/order/expire-orders";
import { envConfig } from "@/lib/env";

/**
 * 超时订单清理（兜底定时器）。
 *
 * 主路径是惰性清扫（订单读取时触发），但"整站无人访问"时惰性清扫不会运行，
 * 因此提供本端点供外部 cron 定时调用，例如：
 *   *\/5 * * * * curl -s -H "x-cron-secret: $CRON_SECRET" https://站点/api/cron/expire
 *
 * 鉴权：专用 CRON_SECRET（与 AUTH_SECRET 隔离，泄露不危及会话签名）。
 * 密钥未配置或错误一律 401，且用常量时间比较防时序侧信道。
 */

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function authorized(request: Request): boolean {
  const expected = envConfig.cronSecret;
  if (!expected) return false; // 未配置 → 一律拒绝（fail closed）
  const header = request.headers.get("x-cron-secret") ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const given = header || bearer;
  if (!given) return false;
  return safeEqual(given, expected);
}

function handle(request: Request): Response {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const overdueBefore = countOverduePending();
  const result = sweepExpiredOrders();
  // 顺带执行日志保留策略：回调端点未认证，日志表增长需设上限（见 purgeOldLogs 注释）
  const purged = purgeOldLogs();
  return Response.json({
    ok: true,
    expired: result.expired,
    orderNos: result.orderNos,
    overdueBefore,
    purged,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

/** GET 便于简单 cron（如 cron-job.org / curl）；同样强制密钥 */
export async function GET(request: Request): Promise<Response> {
  return handle(request);
}
