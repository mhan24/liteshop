import { db } from "@/db";
import { adminLogs } from "@/db/schema";

/** 管理操作审计日志（PLAN §6-③：发货/删卡密/改设置等敏感操作全记录） */
export function logAdmin(
  action: string,
  target: string,
  detail: string,
  ip: string,
  operator = "admin"
): void {
  db.insert(adminLogs)
    .values({ action: safeLogText(action, 128), target: safeLogText(target, 200),
      detail: safeLogText(detail, 4000), ip: safeLogText(ip, 64) })
    .run();
  void operator; // 操作者随会话固定为 admin，预留多管理员扩展
}

function safeLogText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).slice(0, max);
}
