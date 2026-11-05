import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      // ルート直下の auth.ts（テストでは vi.mock で差し替える）
      { find: "@/auth", replacement: path.resolve(__dirname, "auth.ts") },
      { find: "@", replacement: path.resolve(__dirname, "src") },
    ],
  },
  test: { include: ["src/**/*.test.ts"] },
});
