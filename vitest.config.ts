import path from "node:path";
import os from "node:os";
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
    include: ["src/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      PAYMENT_DRIVER: "mock",
      // 每次运行全新数据目录，避免历史迁移残留（目录由系统临时目录回收）
      DATA_DIR: path.join(os.tmpdir(), `liteshop-vitest-${process.pid}-${Date.now()}`),
      AUTH_SECRET: "vitest-secret",
    },
  },
});
