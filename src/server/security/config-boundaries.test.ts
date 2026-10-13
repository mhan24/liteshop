import { afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings, adminLogs } from "@/db/schema";
import { login } from "@/server/auth";
import { getSiteUrl, setSetting } from "@/server/settings";
import { mockProvider } from "@/server/payment/mock";
import { normalizeBepusdtApiBase, bepusdtProvider } from "@/server/payment/bepusdt";
import { logAdmin } from "@/server/admin-log";

afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();db.delete(settings).where(eq(settings.key,"site_url")).run();});
it("未配置哈希不接受公开默认管理员口令",async()=>{
  db.delete(settings).where(eq(settings.key,"admin_password_hash")).run();
  expect((await login("192.0.2.111","admin","admin123")).ok).toBe(false);
});
it("缺失 mock 令牌时验签和建单均拒绝",async()=>{
  vi.stubEnv("MOCK_PAYMENT_TOKEN","");
  expect(mockProvider().verifyNotify('{}').ok).toBe(false);
  await expect(mockProvider().createPayment({orderNo:"x",amountCents:100n,currency:"USD",subject:"x",notifyUrl:"x",redirectUrl:"x"})).rejects.toThrow(/MOCK_PAYMENT_TOKEN/);
});
it.each(["javascript:alert(1)","https://site.test/\" onclick=\"bad", "https://u:p@site.test"])("不把非法站点设置用于回调或邮件：%s",bad=>{
  setSetting("site_url",bad);expect(getSiteUrl()).not.toContain("javascript:");expect(getSiteUrl()).not.toContain("onclick");expect(getSiteUrl()).not.toContain("u:p");
});
it("支付 API 允许显式内网部署，拒绝元数据、凭据、查询，支持服务器来源白名单",()=>{
  expect(normalizeBepusdtApiBase("http://127.0.0.1:8080/")).toBe("http://127.0.0.1:8080");
  for(const bad of ["http://169.254.169.254","http://[::ffff:169.254.169.254]","https://metadata.google.internal","https://u:p@gw.test","https://gw.test/?next=x"])
    expect(normalizeBepusdtApiBase(bad)).toBeUndefined();
  vi.stubEnv("BEPUSDT_ALLOWED_ORIGINS","https://gw.example");
  expect(normalizeBepusdtApiBase("http://localhost:8080")).toBeUndefined();
  expect(normalizeBepusdtApiBase("https://gw.example/api")).toBe("https://gw.example/api");
});
it("网关不能通过返回脚本地址进入付款快照，外呼不跟随重定向",async()=>{
  const fetch=vi.fn(async()=>Response.json({data:{trade_id:"t",payment_url:"javascript:alert(1)"}}));
  vi.stubGlobal("fetch",fetch);
  await expect(bepusdtProvider({api_base:"https://gw.example",token:"t"}).createPayment({orderNo:"x",amountCents:100n,currency:"USD",subject:"x",notifyUrl:"https://shop.example/n",redirectUrl:"https://shop.example/r"})).rejects.toMatchObject({outcome:"unknown"});
  expect(fetch.mock.calls[0]).toBeDefined();
  expect(fetch).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({redirect:"error"}));
});
it("审计记录保持单行、限长，不允许控制字符污染日志导出",()=>{
  const action=`log-${Date.now()}`;logAdmin(action,"user\r\nforged","x\nvalue","192.0.2.1");
  const row=db.select().from(adminLogs).where(eq(adminLogs.action,action)).get()!;
  expect(row.target).not.toMatch(/[\r\n]/);expect(row.detail).not.toMatch(/[\r\n]/);
});
