import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests for the /pi-web extension live in src/extensions and resolve the
    // file at extensions/pi-web.ts by path. They must never live inside
    // extensions/ itself: pi loads every .ts there as an extension.
    include: ["src/**/*.test.ts", "pi-web-plugins/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
