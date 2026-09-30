import { chromium } from "@playwright/test";

/**
 * How soon a daemon-cold session shows its transcript (object model §1.7 and
 * §4.3, P2 slice c).
 *
 * Before: the transcript waited on one `Promise.all` of messages, status and
 * stream-snapshot, all behind the runtime's cold open (1.2-1.8 s on this
 * 17.8 MB session), so no row showed until the status did.
 *
 * Run it right after the session daemon restarts (see the wrapper in the
 * P2c notes), phone 393x850. A link opens the 17.8 MB seed session. Measured
 * in the page from navigation start:
 * - the first transcript row drawn in the chat view;
 * - the selected session's status arriving.
 * Legs:
 * - precondition: the session opened and both arrived;
 * - the first row is drawn before the status arrives (the transcript no longer
 *   waits on the runtime);
 * - the first row is within the budget of 1.5 s (§4.3, "first transcript row,
 *   cold 17.8 MB").
 */
const BASE = process.env.PI_WEB_PROBE_BASE ?? process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const SESSION = "01a05000-5eed-7c00-8000-0000000000c1";
const LINK = `${BASE}/?machine=local&project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac&session=${SESSION}`;
const BUDGET_MS = 1500;

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  const reads = [];
  page.on("response", (response) => {
    const url = response.url();
    if (/\/sessions\/[^/]+\/(transcript-tail|messages|status|stream-snapshot)\?/u.test(url) && url.includes(SESSION)) {
      reads.push(`${url.replace(/^.*\/sessions\/[^/]+\//u, "").replace(/\?.*$/u, "")} ${String(response.status())}`);
    }
  });
  await page.goto(LINK, { waitUntil: "commit" });
  const timing = await page.evaluate(async (sessionId) => {
    const deep = (root) => [...root.querySelectorAll("*")].some((element) => element.matches("chat-view") && element.shadowRoot?.querySelector("article.msg") !== null)
      || [...root.querySelectorAll("*")].some((element) => element.shadowRoot !== null && element.shadowRoot !== undefined && deep(element.shadowRoot));
    let row;
    let status;
    const started = performance.now();
    while (performance.now() - started < 30_000 && (row === undefined || status === undefined)) {
      const state = document.querySelector("pi-web-app")?.state;
      const selected = state?.selectedSession?.id === sessionId;
      if (row === undefined && selected && deep(document)) row = performance.now();
      if (status === undefined && selected && state?.status?.sessionId === sessionId) status = performance.now();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return { row, status };
  }, SESSION);
  await page.screenshot({ path: "/tmp/probe-open-latency.png" });
  const row = timing.row === undefined ? undefined : Math.round(timing.row);
  const status = timing.status === undefined ? undefined : Math.round(timing.status);
  console.log(`first row ${String(row)} ms, status ${String(status)} ms; reads: ${reads.join(", ")}`);
  leg("precondition: the linked session opened, drew a row and got its status", row !== undefined && status !== undefined, `row ${String(row)}, status ${String(status)}`);
  leg("the first row is drawn before the status arrives", row !== undefined && status !== undefined && row < status, `row ${String(row)} ms, status ${String(status)} ms`);
  leg(`the first row is within ${String(BUDGET_MS)} ms of navigation (the §4.3 budget; open until the board's cold listings stop holding every connection)`, row !== undefined && row <= BUDGET_MS, `${String(row)} ms`);
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`${String(passed)}/${String(results.length)} legs passed`);
process.exit(passed === results.length ? 0 : 1);
