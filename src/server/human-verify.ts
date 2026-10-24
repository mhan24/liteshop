import { verifyTurnstileToken } from "@/lib/turnstile";
import {
  getTurnstileSecretKey,
  isTurnstileEnforced,
  isTurnstileFallbackEnabled,
} from "@/server/settings";

/**
 * 公开入口（下单/查单）的人机验证闸门。
 * 返回 null 表示放行；返回字符串为给买家的错误文案。
 *
 * Token 是一次性的：同一 token 只能调用一次 siteverify，
 * 调用方**不得**在校验之后再重复校验同一表单。
 */
export async function humanVerificationError(formData: FormData): Promise<string | null> {
  if (!(await isTurnstileEnforced())) return null;
  const token = String(formData.get("cfToken") ?? "");
  // 空 token 且降级开关开启 → 放行（各入口另有独立限流兜底）；有 token 仍严格校验
  if (token.trim() === "" && (await isTurnstileFallbackEnabled())) return null;
  const result = await verifyTurnstileToken(token, await getTurnstileSecretKey());
  return result.ok ? null : "人机验证未通过，请重新完成验证后再提交";
}
