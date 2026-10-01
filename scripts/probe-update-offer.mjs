import { chromium } from "@playwright/test";

/**
 * The PI WEB update offer opens when the machine reports a newer release, 8505, phone 393x850.
 *
 * The updates plugin read a top-level `version` that `pi-web/status` never carries, so it never
 * knew which version ran and the offer stayed silent on every machine since it shipped
 * (fd56eb53). Legs:
 * - with the local status answering a newer release (a version unique to this run, so no earlier
 *   answer on this machine can settle it), the offer opens and names the running and the new
 *   version;
 * - with the machine's own status (no newer release on 8505), no offer opens.
 * Controls: the rewritten status was the one the page read (one read, fulfilled by the probe),
 * the updates plugin activated, and in the quiet leg the machine's own status reports no newer
 * release (so the silence is the product's, not the environment's). The probe never closes the offer, because closing it records
 * an answer on this machine.
 */
const BASE = "http://127.0.0.1:8505";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};

async function boot(browser, rewrite) {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  let fulfilled = 0;
  let running;
  let ownUpdateAvailable;
  await context.route(/\/api\/pi-web\/status(\?|$)/u, async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    running = status?.components?.web?.installedVersion ?? status?.components?.web?.runtimeVersion;
    ownUpdateAvailable = status?.release?.updateAvailable;
    fulfilled += 1;
    await route.fulfill({ response, json: rewrite === undefined ? status : { ...status, release: { ...status.release, latestVersion: rewrite, updateAvailable: true } } });
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/`);
  const offer = page.getByRole("dialog", { name: /^Update PI WEB / });
  await offer.first().waitFor({ state: "visible", timeout: rewrite === undefined ? 6_000 : 12_000 }).catch(() => undefined);
  const shown = await offer.count() > 0 && await offer.first().isVisible();
  const label = shown ? await offer.first().getAttribute("aria-label") : null;
  const updatesActive = await page.evaluate(() => [...(document.querySelector("pi-web-app")?.plugins?.pluginIds ?? [])].some((id) => String(id) === "updates"));
  await context.close();
  return { shown, label, fulfilled, running, updatesActive, ownUpdateAvailable };
}

const browser = await chromium.launch();
try {
  const newer = `9.${String(Date.now())}.0`;
  const offered = await boot(browser, newer);
  check("control: the page read the rewritten status once, and the updates plugin activated", offered.fulfilled === 1 && offered.updatesActive, JSON.stringify({ fulfilled: offered.fulfilled, updatesActive: offered.updatesActive }));
  check("precondition: the machine reports the version it runs", typeof offered.running === "string", String(offered.running));
  check("a newer release opens the offer", offered.shown, `label ${String(offered.label)}`);
  check("the offer names the running and the new version", offered.label === `Update PI WEB ${String(offered.running)} to ${newer}`, String(offered.label));
  const quiet = await boot(browser, undefined);
  check("control: the updates plugin activated on the machine's own status", quiet.updatesActive && quiet.fulfilled === 1, JSON.stringify({ updatesActive: quiet.updatesActive, fulfilled: quiet.fulfilled }));
  check("precondition: the machine's own status reports no newer release", quiet.ownUpdateAvailable === false, String(quiet.ownUpdateAvailable));
  check("no newer release, no offer", !quiet.shown);
} finally {
  await browser.close();
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
