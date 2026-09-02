/**
 * End-to-end checks for the release, against a running stack.
 *
 * Unit tests proved each half of the plugin-presence feature while the wire
 * between them was disconnected, so these checks read what the daemon actually
 * sends and what the browser actually renders. Anything that cannot be reached
 * is reported as "not reached" rather than passing quietly: a check nobody ran
 * must not read as a check that passed.
 */
import { chromium, devices } from "@playwright/test";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:8505";
const results = [];
function record(name, verdict, detail) {
  results.push({ name, verdict, detail });
  console.log(`[${verdict}] ${name}: ${detail}`);
}

// 1. The daemon's own answer, read off the HTTP surface.
const cwd = process.cwd();
try {
  const sessionsResponse = await fetch(`${baseUrl}/api/sessions?cwd=${encodeURIComponent(cwd)}`, { signal: AbortSignal.timeout(15_000) });
  const listed = await sessionsResponse.json();
  const first = Array.isArray(listed) ? listed[0] : listed?.sessions?.[0];
  if (first === undefined) {
    record("daemon publishes pluginSurfaces", "not reached", "no session in this workspace to ask about");
  } else {
    // The cwd is required here too; without it the daemon answers with an
    // error object, which reads exactly like a missing field.
    const statusResponse = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(first.id)}/status?cwd=${encodeURIComponent(cwd)}`, { signal: AbortSignal.timeout(15_000) });
    const status = await statusResponse.json();
    if (typeof status?.error === "string") {
      record("daemon publishes pluginSurfaces", "not reached", `daemon refused the read: ${status.error}`);
    } else {
      const surfaces = status?.pluginSurfaces;
      record(
        "daemon publishes pluginSurfaces",
        surfaces === undefined ? "check" : "ok",
        surfaces === undefined ? "field absent - runtime could not answer, or the producer is not wired" : JSON.stringify(surfaces),
      );
    }
  }
} catch (error) {
  record("daemon publishes pluginSurfaces", "not reached", error instanceof Error ? error.message : String(error));
}

// 2. What the browser holds after parsing, and what it draws.
const browser = await chromium.launch();
const page = await browser.newPage({ ...devices["Pixel 7"] });
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => { consoleErrors.push(`pageerror: ${error.message}`); });

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(3000);

  const tiles = await page.evaluate(() => {
    const found = [];
    const visit = (root) => {
      for (const el of root.querySelectorAll(".list-body.tiles .action-row")) found.push(Math.round(el.getBoundingClientRect().height));
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) visit(el.shadowRoot);
    };
    visit(document);
    return found;
  });
  const rowHeights = [...new Set(tiles)];
  record("tiles in a row share a height", tiles.length === 0 ? "not reached" : rowHeights.length <= 2 ? "ok" : "check", tiles.length === 0 ? "no tiles on screen" : `distinct heights: ${JSON.stringify(rowHeights)}`);

  const overlaps = await page.evaluate(() => {
    let clipped = 0;
    const visit = (root) => {
      for (const row of root.querySelectorAll(".list-body.tiles .action-row")) {
        const label = row.querySelector(".workspace-primary-label");
        const menu = row.querySelector(".action-menu");
        if (label === null || menu === null) continue;
        if (label.getBoundingClientRect().right > menu.getBoundingClientRect().left) clipped += 1;
      }
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) visit(el.shadowRoot);
    };
    visit(document);
    return clipped;
  });
  record("titles clear the actions button", overlaps === 0 ? "ok" : "check", overlaps === 0 ? "no title overlaps its menu button" : `${overlaps} titles run under the button`);

  const stuck = await page.evaluate(() => {
    const text = document.body.innerText;
    return ["Loading this session", "Session not found"].filter((phrase) => text.includes(phrase));
  });
  record("no stranded notices", stuck.length === 0 ? "ok" : "check", stuck.length === 0 ? "none on the landing surface" : stuck.join(", "));

  record("console", consoleErrors.length === 0 ? "ok" : "check", consoleErrors.length === 0 ? "clean" : JSON.stringify(consoleErrors.slice(0, 3)));

  // The wire, checked from the browser's side. This parser has silently
  // dropped three features by not naming their fields, so the round trip is
  // asserted rather than assumed. The built bundle has no source paths to
  // import, so the check reads what the running app actually holds: fetch a
  // status through the app's own origin and confirm the field survived.
  const roundTrip = await page.evaluate(async (workspace) => {
    try {
      const listed = await (await fetch(`api/sessions?cwd=${encodeURIComponent(workspace)}`)).json();
      const sessions = Array.isArray(listed) ? listed : listed?.sessions ?? [];
      const first = sessions[0];
      if (first === undefined) return "no session to ask about";
      const status = await (await fetch(`api/sessions/${encodeURIComponent(first.id)}/status?cwd=${encodeURIComponent(workspace)}`)).json();
      if (typeof status?.error === "string") return `daemon refused: ${status.error}`;
      return JSON.stringify(status.pluginSurfaces);
    } catch (error) {
      return `unreachable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }, cwd);
  record("the field survives to the browser", roundTrip.startsWith("{") ? "ok" : "not reached", roundTrip);
  await page.screenshot({ path: "/tmp/review-8505/release.png" });
} catch (error) {
  record("browser checks", "not reached", error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}

const needAttention = results.filter((r) => r.verdict !== "ok");
console.log(`\n${results.length} checks, ${needAttention.length} needing attention`);
if (needAttention.length > 0) console.log(needAttention.map((r) => `  ${r.verdict}: ${r.name}`).join("\n"));
