import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration for the isolated Docker instance.
 *
 * The suite deliberately does not start a server: it runs against the
 * container brought up by `docker/pi-web-docker --dev start`, whose ports and
 * data directory are chosen in `.pi-web/docker-compose-dev.local.env` to avoid
 * colliding with a host installation. Pointing this at a host instance would
 * mutate real projects, so the base URL must stay an explicit opt-in.
 *
 * Dev mode serves the client and the API on different ports: the Vite dev
 * server (container 8505) applies the TypeScript transform the browser needs,
 * while the API lives on container 8504. UI tests therefore target the dev
 * server and API tests target the API port.
 */
const baseURL = process.env.PI_WEB_E2E_BASE_URL ?? "http://127.0.0.1:8511";
export const apiBaseURL = process.env.PI_WEB_E2E_API_BASE_URL ?? "http://127.0.0.1:8510";

/*
 * Chromium already present on this machine. Playwright's bundled revision is
 * not downloaded (the browser download is skipped at install time), so the
 * executable is named explicitly; override when the local revision differs.
 */
const executablePath = process.env.PI_WEB_E2E_CHROMIUM
  ?? "/home/hanxiaodu/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/globalSetup.ts",
  // The suite mutates one shared server instance (projects, sessions, goal
  // files), so parallel workers would race each other's fixtures.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI === "true",
  reporter: process.env.CI === "true" ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath },
  },
  projects: [
    {
      // The mobile viewport is the point of this work, so it is the default
      // projection rather than an afterthought.
      name: "mobile",
      use: { ...devices["Pixel 7"], launchOptions: { executablePath } },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } },
    },
  ],
});
