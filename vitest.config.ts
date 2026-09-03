import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __PI_WEB_CLIENT_VERSION__: JSON.stringify("0.0.0-test"),
  },
  test: {
    // Tests for the /pi-web extension live in src/extensions and resolve the
    // file at extensions/pi-web.ts by path. They must never live inside
    // extensions/ itself: pi loads every .ts there as an extension.
    include: ["src/**/*.test.ts", "pi-web-plugins/**/*.test.ts", "scripts/**/*.test.mjs"],
    // DOM files opt into happy-dom per file; this setup only repairs a broken
    // `localStorage` global on Node versions that ship the experimental,
    // flag-gated one. It is a no-op in the node environment.
    setupFiles: ["./src/client/testSetup/domStorage.ts"],
  },
});
