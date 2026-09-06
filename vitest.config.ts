import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  define: {
    __PI_WEB_CLIENT_VERSION__: JSON.stringify("0.0.0-test"),
  },
  resolve: {
    alias: {
      // Mirror the tsconfig paths mapping: plugin sources import the public
      // contract by package name, and a value import (the machines plugin's
      // runtime parser) must resolve to the source under vitest, not to a
      // dist emit that may not exist in a clean checkout.
      "@gang-of-beads/pi-web/plugin-api": fileURLToPath(new URL("./src/plugin-api.ts", import.meta.url)),
      "@gang-of-beads/pi-web/server-plugin-api": fileURLToPath(new URL("./src/server-plugin-api.ts", import.meta.url)),
    },
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
