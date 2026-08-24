/**
 * Live check for the session activity drawer against a running PI WEB.
 *
 * The bug this exists for: subagent runs were fetched only when a session was
 * selected, so a subagent started inside the session already on screen never
 * appeared. That is invisible to unit tests (it is about when the browser
 * refetches), so this drives a real browser: open a session, read the drawer,
 * then create a new run on disk and assert the drawer notices it without a
 * reload.
 *
 * Usage:
 *   node scripts/verify-activity-drawer.mjs \
 *     --base-url http://127.0.0.1:8505 \
 *     --cwd /private/tmp/test \
 *     --session-dir "$HOME/.pi/agent/sessions/--private-tmp-test--/<stamp>_<id>"
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const args = parseArgs(process.argv.slice(2));
const baseUrl = args["base-url"] ?? "http://127.0.0.1:8505";
const projectId = required(args, "project");
const workspaceId = required(args, "workspace");
const sessionDir = required(args, "session-dir");
const sessionId = sessionDir.split("_").at(-1) ?? "";

const probeRunId = `probe-${Date.now().toString(36)}`;
const probeRunDir = join(sessionDir, probeRunId, "run-0");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
const failures = [];
try {
  const route = `${baseUrl}/?project=${encodeURIComponent(projectId)}&workspace=${encodeURIComponent(workspaceId)}&session=${encodeURIComponent(sessionId)}`;
  await page.goto(route, { waitUntil: "networkidle" });
  await page.waitForSelector("pi-web-app");
  // The transcript arrives after the route restore; the drawer follows it.
  await page.waitForTimeout(4000);

  const before = await drawerHeading(page);
  report("drawer visible before a new run", before !== "", before);

  // A live run is a directory with a transcript that was written recently.
  await mkdir(probeRunDir, { recursive: true });
  await writeFile(join(probeRunDir, "session.jsonl"), `${JSON.stringify({ role: "assistant", content: "probe" })}\n`);

  const grew = await waitForChange(page, before, 15_000);
  report("drawer picked up the new run without a reload", grew !== before, `${before} -> ${grew}`);

  // The dock must not claim the chat is idle while its children are running.
  const dock = await dockText(page);
  report("dock names live background work instead of plain idle", /background run/u.test(dock), dock);

  await page.screenshot({ path: "/tmp/pi-web-activity-drawer.png", fullPage: false });
} finally {
  await rm(join(sessionDir, probeRunId), { recursive: true, force: true });
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\nFAILED: ${String(failures.length)} check(s)`);
  process.exit(1);
}
console.log("\nAll checks passed. Screenshot: /tmp/pi-web-activity-drawer.png");

async function drawerHeading(target) {
  return await target.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    const tab = chat?.shadowRoot?.querySelector(".drawer-tab-activity");
    return tab?.textContent?.trim() ?? "";
  });
}

async function dockText(target) {
  return await target.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    const text = chat?.shadowRoot?.querySelector(".activity-dock .activity-text");
    return text?.textContent?.trim() ?? "";
  });
}

async function waitForChange(target, previous, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = previous;
  while (Date.now() < deadline) {
    latest = await drawerHeading(target);
    if (latest !== previous && latest !== "") return latest;
    await target.waitForTimeout(500);
  }
  return latest;
}

function report(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : `  [${detail}]`}`);
  if (!ok) failures.push(name);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/u, "");
    if (key !== undefined) parsed[key] = argv[index + 1] ?? "";
  }
  return parsed;
}

function required(parsed, key) {
  const value = parsed[key];
  if (value === undefined || value === "") throw new Error(`--${key} is required`);
  return value;
}

