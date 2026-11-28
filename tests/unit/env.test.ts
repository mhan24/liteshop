import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const base = { AUTH_SECRET: "x".repeat(32) };

describe("环境变量校验", () => {
  it("回归：生产环境禁止 mock 支付驱动（mock 收银台对任何人开放「确认支付」）", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production", PAYMENT_DRIVER: "mock" })).toThrow(/PAYMENT_DRIVER/);
    expect(parseEnv({ ...base, NODE_ENV: "production", PAYMENT_DRIVER: "auto" }).PAYMENT_DRIVER).toBe("auto");
    expect(parseEnv({ ...base, NODE_ENV: "test", PAYMENT_DRIVER: "mock" }).PAYMENT_DRIVER).toBe("mock");
  });

  it("ADMIN_PATH 规范化，且不能占用 /api、/_next", () => {
    expect(parseEnv({ ...base, ADMIN_PATH: "/secret/" }).ADMIN_PATH).toBe("/secret");
    expect(parseEnv(base).ADMIN_PATH).toBe("/admin");
    expect(() => parseEnv({ ...base, ADMIN_PATH: "/api/x" })).toThrow(/ADMIN_PATH/);
    expect(() => parseEnv({ ...base, ADMIN_PATH: "//ops" })).toThrow(/ADMIN_PATH/);
    expect(() => parseEnv({ ...base, ADMIN_PATH: "/ops//login" })).toThrow(/ADMIN_PATH/);
  });
});
