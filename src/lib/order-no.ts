/**
 * 订单号生成（PLAN §3）：LS + YYYYMMDD + 8 位随机(base32) + 2 位校验和
 * 非自增、不暴露销量；唯一性由 orders.order_no 唯一索引兜底，服务层冲突重试。
 */

import { randomInt } from "node:crypto";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // 去除易混淆字符的 base32

/**
 * 生成随机段。
 *
 * 默认使用 CSPRNG（crypto.randomInt）而非 Math.random：
 * 订单号是「查单 + 取货」的凭据之一（配合邮箱双因子），
 * Math.random 的输出可被观测后预测，理论上允许枚举他人订单。
 * 仍保留 rand 注入点以便测试确定性。
 */
function randomChars(n: number, rand?: () => number): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += ALPHABET[rand ? Math.floor(rand() * ALPHABET.length) : randomInt(ALPHABET.length)];
  }
  return out;
}

/** 校验和：djb2 变体，映射到 2 个字母表字符 */
function checksum(body: string): string {
  let h = 5381;
  for (let i = 0; i < body.length; i++) {
    h = ((h << 5) + h + body.charCodeAt(i)) >>> 0;
  }
  const a = ALPHABET[h % ALPHABET.length];
  const b = ALPHABET[Math.floor(h / ALPHABET.length) % ALPHABET.length];
  return a + b;
}

export function generateOrderNo(now: Date = new Date(), rand?: () => number): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const body = `LS${y}${m}${d}${randomChars(8, rand)}`;
  return body + checksum(body);
}

export function isValidOrderNo(orderNo: string): boolean {
  if (!/^LS\d{8}[2-9A-HJKMNP-Z]{8}[2-9A-HJKMNP-Z]{2}$/.test(orderNo)) return false;
  const body = orderNo.slice(0, -2);
  return checksum(body) === orderNo.slice(-2);
}
