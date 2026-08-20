#!/usr/bin/env node
/**
 * Screenshot the dev container's UI at the viewports that matter.
 *
 * Design work needs a picture, not a description: this drives the running
 * `docker/pi-web-docker --dev` instance (Vite on 8511) and writes PNGs under
 * /tmp/pi-web-shots so a change can be looked at instead of assumed.
 *
 *   node scripts/shot.mjs [label] [--url=http://127.0.0.1:8511] [--wait=1500]
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const label = args.find((arg) => !arg.startsWith("--")) ?? "shot";
const flag = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
};

const url = flag("url", "http://127.0.0.1:8511/");
const waitMs = Number(flag("wait", "2000"));
const outDir = flag("out", "/tmp/pi-web-shots");
const executablePath = process.env.PI_WEB_E2E_CHROMIUM
  ?? "/home/hanxiaodu/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900, isMobile: false },
  { name: "narrow", width: 1100, height: 850, isMobile: false },
  { name: "mobile", width: 390, height: 844, isMobile: true },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath });
const written = [];
for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    isMobile: viewport.isMobile,
    hasTouch: viewport.isMobile,
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(waitMs);
  const path = join(outDir, `${label}-${viewport.name}.png`);
  await page.screenshot({ path });
  written.push(path);
  await context.close();
}
await browser.close();
console.log(written.join("\n"));
