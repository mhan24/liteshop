import { afterEach, expect, it, vi } from "vitest";
import { normalizeHttpUrl } from "./http-url";
import { openPaymentWindow, toAbsoluteUrl } from "./open-payment-window";
import { secureCookie } from "./cookie-policy";

afterEach(()=>vi.unstubAllGlobals());
it.each(["javascript:alert(1)","data:text/html,x","file:///etc/passwd","blob:https://x/id","https://u:p@example.com","https://example.com/a\nb","https:\\evil.test"])("危险链接不进入窗口或当前页跳转：%s",raw=>{
  const open=vi.fn();const location={origin:"https://shop.example",href:"https://shop.example/"};
  vi.stubGlobal("window",{open,location});
  openPaymentWindow(raw);expect(open).not.toHaveBeenCalled();expect(location.href).toBe("https://shop.example/");
  expect(toAbsoluteUrl(raw)).toBe("");
});
it("允许合法外部支付与站内 mock，相对地址规范化",()=>{
  expect(normalizeHttpUrl("https://gateway.example/checkout")).toBe("https://gateway.example/checkout");
  const open=vi.fn(()=>null);const location={origin:"http://localhost:3000",href:""};
  vi.stubGlobal("window",{open,location});openPaymentWindow("/pay/mock?order_no=LS");
  expect(open).toHaveBeenCalled();expect(location.href).toBe("http://localhost:3000/pay/mock?order_no=LS");
});
it("生产 Secure 不接受请求头降级，本地 HTTP 开发保持可用",()=>{
  expect(secureCookie(true,"http")).toBe(true);expect(secureCookie(true,null)).toBe(true);
  expect(secureCookie(false,"https")).toBe(true);expect(secureCookie(false,"http")).toBe(false);
});
