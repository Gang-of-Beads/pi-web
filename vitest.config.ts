import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // extensions/ ships in the package and registers the /pi-web command, but
    // was outside the test run entirely - so nothing checked it.
    include: ["src/**/*.test.ts", "pi-web-plugins/**/*.test.ts", "extensions/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
