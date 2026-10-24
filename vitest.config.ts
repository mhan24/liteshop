import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // 单实例 Postgres：测试文件串行执行，避免锁竞争干扰断言
    fileParallelism: false,
    globalSetup: "./tests/global-setup.ts",
    testTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://postgres:liteshop-test@localhost:54330/liteshop_test",
      AUTH_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
      SITE_URL: "http://localhost:3000",
      ADMIN_PATH: "/admin",
      PAYMENT_DRIVER: "mock",
      CRON_SECRET: "test-cron-secret",
    },
  },
});
