import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, jsonForScriptTag } from "@/lib/security-headers";

describe("安全响应头", () => {
  it("生产 CSP 不含 unsafe-eval，放行 Turnstile，禁止嵌入与外部表单提交", () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(contentSecurityPolicy(true)).toContain("'unsafe-eval'");
  });

  it("回归：JSON-LD 中的 </script> 被转义，无法截断脚本标签", () => {
    const out = jsonForScriptTag({ name: "x</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out)).toEqual({ name: "x</script><script>alert(1)</script>" });
  });
});
