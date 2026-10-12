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
    // 含 .tsx：组件级回归测试用 react-dom/server 渲染后断言 DOM
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // SQLite 单文件 + 单写者：并行测试文件会互相抢锁（database is locked）。
    // 业务代码本身依赖 IMMEDIATE 事务串行化，因此测试也必须串行执行。
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      PAYMENT_DRIVER: "mock",
      // 每次运行全新数据目录，避免历史迁移残留（目录由系统临时目录回收）
      DATA_DIR: path.join(os.tmpdir(), `liteshop-vitest-${process.pid}-${Date.now()}`),
      AUTH_SECRET: "vitest-secret",
    },
  },
});
