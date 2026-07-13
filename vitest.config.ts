import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@jmfederico/pi-web-tunnel-frp-engine": resolve(
        import.meta.dirname,
        "packages/tunnel-frp-engine/src/index.ts",
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "pi-web-plugins/**/*.test.ts", "packages/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
