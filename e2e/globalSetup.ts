import { chromium } from "@playwright/test";

const BOOT_TIMEOUT_MS = 20_000;

/**
 * A container that has been serving for a while can hand out a stale module
 * graph. The app then fails to boot and every UI test times out separately,
 * which reads like dozens of unrelated regressions in the code under test.
 * Asking whether the app starts costs seconds and answers that first.
 */
export default async function globalSetup(): Promise<void> {
  const baseURL = process.env["PI_WEB_E2E_BASE_URL"] ?? "http://127.0.0.1:8511";
  const executablePath = process.env["PI_WEB_E2E_CHROMIUM"];
  const browser = await chromium.launch(executablePath === undefined || executablePath === "" ? {} : { executablePath });
  const pageErrors: string[] = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => { pageErrors.push(String(error)); });
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const element = document.querySelector("pi-web-app");
      return element !== null && typeof Reflect.get(element, "requestUpdate") === "function";
    }, undefined, { timeout: BOOT_TIMEOUT_MS });
  } catch (cause) {
    const detail = pageErrors[0] ?? "the pi-web-app element never upgraded";
    throw new Error(`The app at ${baseURL} did not start: ${detail}. Restart the dev containers before reading anything into the suite.`, { cause });
  } finally {
    await browser.close();
  }
}
