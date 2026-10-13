import { cookies } from "next/headers";
import { envConfig } from "@/lib/env";
import { hmacHex, safeEqualHex, sha256Hex } from "@/lib/signature";
import { isValidOrderNo } from "@/lib/order-no";

const TTL = 86400;
export const orderCookieName = (no: string) => `ls_order_${sha256Hex(no).slice(0, 16)}`;

/** 仅在成功建单或订单号+邮箱验证通过后签发；不在公开页面渲染时签发。 */
export async function grantOrderAccess(orderNo: string): Promise<void> {
  if (!isValidOrderNo(orderNo) || !envConfig.authSecret) throw new Error("无法签发订单访问凭据");
  const body = `${orderNo}.${Math.floor(Date.now() / 1000) + TTL}`;
  const token = `${body}.${hmacHex(envConfig.authSecret, `buyer-order:${body}`)}`;
  (await cookies()).set(orderCookieName(orderNo), token, {
    httpOnly: true, secure: envConfig.isProd, sameSite: "lax", path: "/", maxAge: TTL,
  });
}

/** 签名、订单绑定和有效期全部匹配才允许读取付款及订单信息。 */
export async function hasOrderAccess(orderNo: string): Promise<boolean> {
  if (!isValidOrderNo(orderNo) || !envConfig.authSecret) return false;
  const value = (await cookies()).get(orderCookieName(orderNo))?.value;
  if (!value || value.length > 256) return false;
  const [no, expiry, signature, extra] = value.split(".");
  if (extra !== undefined || no !== orderNo || !/^\d+$/.test(expiry ?? "") || !/^[a-f0-9]{64}$/.test(signature ?? "")) return false;
  const seconds = Number(expiry);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(seconds) || seconds <= now || seconds > now + TTL) return false;
  return safeEqualHex(signature, hmacHex(envConfig.authSecret, `buyer-order:${no}.${expiry}`));
}
