import { beforeEach, expect, it, vi } from "vitest";
import { generateOrderNo } from "@/lib/order-no";
const { values, options } = vi.hoisted(()=>({values:new Map<string,string>(),options:vi.fn()}));
vi.mock("next/headers",()=>({
  cookies:async()=>({get:(name:string)=>values.has(name)?{value:values.get(name)}:undefined,
    set:(name:string,value:string,opts:unknown)=>{values.set(name,value);options(opts);}}),
  headers:async()=>new Headers({"x-forwarded-for":"192.0.2.23"}),
}));
import { grantOrderAccess, hasOrderAccess, orderCookieName } from "./access";
import { GET } from "@/app/api/orders/status/route";
import { createOrderAction, lookupOrderAction } from "@/actions/shop";
import { seedAuto } from "./test-helpers";
import { resetRateBuckets } from "@/server/security/rate-limit";
import { setSetting } from "@/server/settings";

beforeEach(()=>{values.clear();options.mockClear();resetRateBuckets();setSetting("turnstile_enabled","0");});
it("没有凭据及跨订单、篡改、过期凭据均拒绝",async()=>{
  const no=generateOrderNo(),other=generateOrderNo();
  expect(await hasOrderAccess(no)).toBe(false);
  await grantOrderAccess(no);
  expect(await hasOrderAccess(no)).toBe(true);
  expect(options).toHaveBeenCalledWith(expect.objectContaining({httpOnly:true,sameSite:"lax",maxAge:86400}));
  values.set(orderCookieName(other),values.get(orderCookieName(no))!);
  expect(await hasOrderAccess(other)).toBe(false);
  const original=values.get(orderCookieName(no))!;
  values.set(orderCookieName(no),original.slice(0,-1)+(original.endsWith("a")?"b":"a"));
  expect(await hasOrderAccess(no)).toBe(false);
  values.set(orderCookieName(no),original);
  vi.useFakeTimers();
  try{vi.setSystemTime(Date.now()+86401*1000);expect(await hasOrderAccess(no)).toBe(false);}
  finally{vi.useRealTimers();}
});
it("正常下单签发凭据；仅订单号不能读 API 或付款页，双因子查单可恢复",async()=>{
  const p=seedAuto(["access-card"]);
  const form=new FormData();form.set("slug",p.slug);form.set("email","owner@example.test");form.set("quantity","1");
  const result=await createOrderAction(null,form);
  expect(result.error).toBeUndefined();expect(result.orderNo).toBeDefined();
  const no=result.orderNo!;
  const request=()=>new Request(`https://shop.example/api/orders/status?order_no=${no}`,{headers:{"x-forwarded-for":"192.0.2.23"}});
  expect((await GET(request())).status).toBe(200);
  values.clear();
  const denied=await GET(request());expect(denied.status).toBe(404);
  expect(await denied.text()).not.toContain(p.slug);
  const { default: Pending }=await import("@/app/(shop)/pay/pending/page");
  const { renderToStaticMarkup }=await import("react-dom/server");
  expect(renderToStaticMarkup(await Pending({searchParams:Promise.resolve({order_no:no})}))).toContain("请验证订单信息");
  form.set("orderNo",no);form.set("email","wrong@example.test");
  expect((await lookupOrderAction(null,form)).order).toBeUndefined();expect(await hasOrderAccess(no)).toBe(false);
  form.set("email","owner@example.test");
  expect((await lookupOrderAction(null,form)).order).toBeDefined();expect(await hasOrderAccess(no)).toBe(true);
  const response=await GET(request());expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).order.emailMasked).toBe("***");
});
it("轮询预算独立且在查库之前拦截高频请求",async()=>{
  const no=generateOrderNo();
  const request=()=>new Request(`https://shop.example/api/orders/status?order_no=${no}`,{headers:{"x-forwarded-for":"198.51.100.70"}});
  for(let i=0;i<60;i++)expect((await GET(request())).status).toBe(404);
  const denied=await GET(request());expect(denied.status).toBe(429);expect(denied.headers.get("retry-after")).toBeTruthy();
});
