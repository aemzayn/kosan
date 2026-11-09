import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@kosan/core": path.resolve("../core/src/index.ts"),
      "@kosan/sequelize": path.resolve("../sequelize/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
