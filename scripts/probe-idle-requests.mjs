import { chromium } from "@playwright/test";

/**
 * An idle page on a git workspace must stop asking itself the same question.
 *
 * `git status` refreshes .git/index; the daemon's workspace watcher reports that
 * write; the client refetches the tree and the status; the status refreshes the
 * index again. Measured on the owner's session before the fix: 13 tree and 13
 * status requests in four idle seconds and 18 app renders a second, and the page
 * visibly shook. `git --no-optional-locks` breaks the loop.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PROBE_REPO_PROJECT ?? "f4ad2c1e-58eb-4a30-abd9-0f87eff30022";
const WORKSPACE = process.env.PROBE_REPO_WORKSPACE ?? "61beb7f600dd";
const SESSION = process.env.PROBE_REPO_SESSION ?? "01a0af4c-6b1e-76c5-a65f-5a60aff24102";
// Long enough that the git panel's own 8s poll lands at least once, so "no
// requests at all" cannot pass as "no loop".
const WINDOW_MS = 10_000;
const REPEAT_LIMIT = 3;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const seen = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/\/api\//u.test(url)) seen.push(url.replace(/^https?:\/\/[^/]+/u, "").split("?")[0]);
  });
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  seen.length = 0;
  const renders = await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app.shadowRoot.querySelector("chat-view");
    const counter = { updated: 0 };
    if (chat !== null) {
      const updated = Reflect.get(chat, "updated");
      Reflect.set(chat, "updated", function (...args) { counter.updated += 1; return Reflect.apply(updated, this, args); });
    }
    Reflect.set(window, "probeRenders", () => counter.updated);
    return "counting";
  });
  await page.waitForTimeout(WINDOW_MS);
  const renderCount = await page.evaluate(() => Reflect.get(window, "probeRenders")());
  const tally = new Map();
  for (const path of seen) tally.set(path, (tally.get(path) ?? 0) + 1);
  const worst = [...tally.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3);
  const loop = worst.find(([, count]) => count > REPEAT_LIMIT);
  console.log(`idle ${String(WINDOW_MS)}ms: ${String(seen.length)} api requests, ${String(renderCount)} chat renders`);
  console.log("worst:", worst.map(([path, count]) => `${String(count)}× ${path}`).join(" | "));
  // Zero requests is a legitimate fixed state (nothing on this surface polls),
  // so it is not treated as "proves nothing": the probe's failing twin on an
  // unfixed build is what proves it can see the traffic.
  if (loop !== undefined) {
    console.log(`FAIL ${loop[0]} repeated ${String(loop[1])}× while idle (limit ${String(REPEAT_LIMIT)}) - the page is polling itself`);
    process.exitCode = 1;
  } else {
    console.log(`PASS the idle page stopped polling itself (${String(seen.length)} requests, ${String(renderCount)} renders)`);
  }
} finally {
  await browser.close();
}
