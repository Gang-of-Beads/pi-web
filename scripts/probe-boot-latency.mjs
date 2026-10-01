import { chromium } from "@playwright/test";

/**
 * A deep link on a slow link (object-model §4.7; P7 slice a), 8505, phone 393x850.
 *
 * Chrome emulates a 100 ms round trip, about what the Mac sees reading 8504 over the tailnet. A
 * warm reload of a deep link to the small seed session is measured from navigation start.
 * Before P7 slice a, the browser plugins were about 70 module files imported up to ten levels
 * deep, each level one round trip, and the route restore waits for them: the first row took
 * 2.3 s, about 1.5 s of it the plugin waterfall.
 * Legs:
 * - precondition: the session opened and drew its first row;
 * - every plugin module the boot loads is asked for within one round trip of the first one
 *   (no waterfall: each plugin is one file, lazy chunks aside);
 * - the first row within 1.7 s at 100 ms. Measured 1.36–1.49 s with all 15 plugins; the ceiling
 *   leaves room for load without letting the waterfall (2.3 s) back. §4.3's 1.0 s needs the
 *   place-before-plugins slice, and the leg tightens with it;
 * - every plugin in the manifest registered, and none failed to load (bundling must not break one);
 * - the seed session's mermaid fence is drawn as a diagram (the vendored engine still loads lazily
 *   from beside the bundled entry, through import.meta.url).
 * The numbers printed are the measurement; the legs are the budget.
 */
const BASE = process.env.PI_WEB_PROBE_BASE ?? process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const SESSION = "01a05000-5eed-7c00-8000-0000000000e1";
const LINK = `${BASE}/?project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac&session=${SESSION}`;
const LATENCY_MS = 100;
const FIRST_ROW_MS = 1_700;
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(LINK);
  await page.waitForTimeout(3_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: LATENCY_MS, downloadThroughput: -1, uploadThroughput: -1 });
  const pluginModules = [];
  const loadFailures = [];
  page.on("console", (message) => { if (message.text().includes("Failed to load PI WEB plugin") || message.text().includes("Failed to register PI WEB plugin")) loadFailures.push(message.text().slice(0, 160)); });
  let started = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/pi-web-plugins/") && path.endsWith(".js") && !path.includes("/vendor/")) pluginModules.push({ at: Date.now() - started, path });
  });
  started = Date.now();
  await page.goto(LINK, { waitUntil: "commit" });
  const row = await page.evaluate(async (sessionId) => {
    const deep = (root) => [...root.querySelectorAll("*")].some((element) => element.matches("chat-view") && element.shadowRoot?.querySelector("article.msg") !== null)
      || [...root.querySelectorAll("*")].some((element) => element.shadowRoot !== null && element.shadowRoot !== undefined && deep(element.shadowRoot));
    const begun = performance.now();
    while (performance.now() - begun < 20_000) {
      if (document.querySelector("pi-web-app")?.state?.selectedSession?.id === sessionId && deep(document)) return Math.round(performance.now());
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return undefined;
  }, SESSION);
  await page.waitForTimeout(4_000);
  const manifest = await (await fetch(`${BASE}/pi-web-plugins/manifest.json`)).json();
  const registered = await page.evaluate((ids) => { const app = document.querySelector("pi-web-app"); return ids.filter((id) => app?.plugins?.hasPlugin(id) !== true); }, manifest.plugins.map((plugin) => plugin.id));
  const diagrams = await page.evaluate(() => {
    const count = (root) => [...root.querySelectorAll("*")].reduce((sum, element) => sum + (element.shadowRoot ? count(element.shadowRoot) : 0), root.querySelectorAll("svg[id^=\"mermaid\"], svg[aria-roledescription]").length);
    return count(document);
  });
  const firstModule = pluginModules[0]?.at;
  const lastModule = pluginModules.at(-1)?.at;
  const spread = firstModule === undefined || lastModule === undefined ? undefined : lastModule - firstModule;
  console.log(`first row ${String(row)} ms; ${String(pluginModules.length)} plugin modules asked for between ${String(firstModule)} and ${String(lastModule)} ms`);
  check("precondition: the session opened and drew its first row", row !== undefined, `${String(row)} ms`);
  check("precondition: the boot loaded plugin modules", pluginModules.length > 0, `${String(pluginModules.length)} modules`);
  check(`every plugin module is asked for within one round trip of the first (${String(LATENCY_MS)} ms)`, spread !== undefined && spread < LATENCY_MS + 50, `spread ${String(spread)} ms over ${String(pluginModules.length)} modules`);
  check("every manifest plugin registered", registered.length === 0, registered.length === 0 ? `${String(manifest.plugins.length)} plugins` : `missing ${registered.join(", ")}`);
  check("no plugin failed to load", loadFailures.length === 0, loadFailures.join(" | "));
  check("the mermaid fence is drawn as a diagram", diagrams > 0, `${String(diagrams)} diagrams`);
  check(`the first row within ${String(FIRST_ROW_MS)} ms at a ${String(LATENCY_MS)} ms round trip`, row !== undefined && row <= FIRST_ROW_MS, `${String(row)} ms`);
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
