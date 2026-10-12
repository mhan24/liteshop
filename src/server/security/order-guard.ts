import { getTurnstileSecretKey, isTurnstileEnforced } from "@/server/settings";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { checkOrderRateLimit } from "@/server/security/rate-limit";
import { clientIpFromHeaders } from "@/server/security/client-ip";

/**
 * 下单入口的统一防护。
 *
 * **所有**会创建订单的入口都必须经过这里，包括：
 * - 正常购买（createOrderAction）
 * - 过期订单重新购买（repurchaseOrderAction）
 *
 * 历史缺陷：重新购买只校验了订单号/邮箱/原单状态就直接建单，
 * 绕过了 Turnstile 与限流。持有自己一笔过期订单的用户可以反复调用，
 * 每次都会真实预留卡密或扣减库存，从而把在售库存刷空。
 *
 * 因此把校验集中到本模块，任何新入口只要调用它即获得同等保护。
 */

export interface OrderGuardResult {
  ok: boolean;
  error?: string;
  /** 校验通过时的请求来源 IP（供后续审计/额外限流使用） */
  ip?: string;
}

/** 取请求来源 IP（经反向代理时取**受信代理写入的**那一段，防伪造） */
export async function clientIp(): Promise<string> {
  return clientIpFromHeaders();
}

/**
 * 执行人机验证 + 下单限流。
 * 任一不通过即返回 ok=false，调用方**必须**直接返回错误、不得继续建单。
 */
export async function guardOrderCreation(
  formData: FormData,
  email: string
): Promise<OrderGuardResult> {
  // 人机验证：仅当「开关开启 + Site/Secret 齐备」时强制（与前端渲染条件一致）
  if (isTurnstileEnforced()) {
    const token = String(formData.get("cfToken") ?? "");
    const verify = await verifyTurnstileToken(token, getTurnstileSecretKey());
    if (!verify.ok) {
      return { ok: false, error: "人机验证未通过，请重新完成验证后提交" };
    }
  }

  const ip = await clientIp();

  // 频率限制：Turnstile 关闭时这是唯一的防线
  const limited = checkOrderRateLimit(ip, email);
  if (!limited.ok) {
    return { ok: false, error: limited.message ?? "操作过于频繁，请稍后再试" };
  }

  return { ok: true, ip };
}
