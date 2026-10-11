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
    .values({ action, target, detail, ip })
    .run();
  void operator; // 操作者随会话固定为 admin，预留多管理员扩展
}
