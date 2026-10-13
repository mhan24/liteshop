/**
 * Next.js 服务器启动钩子（nodejs 运行时，standalone 单进程）。
 *
 * 应用内定时器：超时订单清扫 + 日志保留清理。
 * 此前依赖「惰性清扫（有人打开订单页）+ 外部 cron 调 /api/cron/expire」，
 * 两者都不可靠：无人访问的过期订单会永远 pending、卡密/库存永久占用。
 * standalone 部署恰是单进程，进程内 setInterval 即为可靠的全局定时器。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // 构建阶段（next build 收集页面数据）不启动定时器
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const globalScope = globalThis as unknown as { __liteshopTimers?: boolean };
  if (globalScope.__liteshopTimers) return; // 热重载/重复 register 防护
  globalScope.__liteshopTimers = true;

  const { sweepExpiredOrders } = await import("@/server/order/expire-orders");

  const sweep = async () => {
    try {
      const result = sweepExpiredOrders();
      if (result.expired > 0) {
        console.log("[sweep] closed overdue pending orders:", result.orderNos.join(","));
      }
    } catch (err) {
      console.error("[sweep] failed:", err);
    }
  };

  // 首跑延迟 5s（避开启动窗口），此后每分钟一次
  const sweepTimer = setInterval(() => void sweep(), 60_000);
  const bootTimer = setTimeout(() => void sweep(), 5_000);

  // 日志保留：每小时清一次
  const purgeTimer = setInterval(async () => {
    try {
      await import("@/server/order/expire-orders").then((m) => m.purgeOldLogs());
    } catch (err) {
      console.error("[purge] failed:", err);
    }
  }, 3_600_000);

  // 不阻止进程退出
  sweepTimer.unref?.();
  bootTimer.unref?.();
  purgeTimer.unref?.();
}
