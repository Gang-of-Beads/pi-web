import { chromium } from "@playwright/test";

/**
 * A remote machine's plugins load beside the gateway's (B51), 8505, phone 393x850.
 *
 * A selected remote machine's own copy of a machine-specific plugin is imported into the same page
 * as the gateway's copy. A module that defined a custom element without checking whether the name
 * was taken threw on that second import, so a remote machine had no Goals page, terminal,
 * subagents card or workspaces plugin. The probe adds 8505 to its own roster as a remote machine
 * (removed at the end) and opens it. Like every 8505 probe, it uses the stack's seed project,
 * workspace and session, and blocks `prod-8504-waveb`, the production machine on 8505's roster, so
 * no probe traffic reaches production.
 * Legs:
 * - no plugin module of the remote machine fails to load;
 * - the remote machine's Go to sheet lists Goals (goals is machine-specific, so only the remote's
 *   own copy can offer it while the remote is selected).
 * Controls: the remote machine is selected, and its plugin manifest was read.
 */
const BASE = "http://127.0.0.1:8505";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};

const added = await fetch(`${BASE}/api/machines`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "probe-remote-plugins", baseUrl: `${BASE}/` }) });
const addedBody = added.ok ? await added.json() : undefined;
const remoteId = addedBody?.machine?.id ?? addedBody?.id;
check("precondition: 8505 is on its own roster as a remote machine", typeof remoteId === "string", `${String(added.status)} ${String(remoteId)}`);
let browser;
try {
  browser = await chromium.launch();
  if (typeof remoteId === "string") {
    const hex = Buffer.from(remoteId).toString("hex");
    const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
    await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    const failures = [];
    let manifestRead = false;
    page.on("console", (message) => {
      const text = message.text();
      if (text.startsWith("Failed to load PI WEB plugin") && text.includes(`machine.${hex}.`)) failures.push(/Failed to load PI WEB plugin (\S+)/u.exec(text)?.[1] ?? text.slice(0, 80));
    });
    page.on("response", (response) => {
      if (response.url().includes(`/api/machines/${encodeURIComponent(remoteId)}/pi-web-plugins/manifest.json`) && response.ok()) manifestRead = true;
    });
    await page.goto(`${BASE}/?machine=${encodeURIComponent(remoteId)}&project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac&session=01a05000-5eed-7c00-8000-0000000000c1`);
    await page.waitForTimeout(8_000);
    const selected = await page.evaluate(() => document.querySelector("pi-web-app")?.state?.selectedMachine?.id ?? null);
    await page.locator("app-context-bar button[aria-label='Go to a view']").click();
    await page.waitForTimeout(1_200);
    const labels = (await page.locator("app-go-to-sheet button.destination .destination-label").allTextContents()).map((label) => label.trim());
    await context.close();
    check("control: the remote machine is selected and its plugin manifest was read", selected === remoteId && manifestRead, JSON.stringify({ selected, manifestRead }));
    check("no plugin module of the remote machine fails to load", failures.length === 0, JSON.stringify(failures));
    check("the remote machine's Go to sheet lists Goals", labels.includes("Goals"), JSON.stringify(labels));
  }
} finally {
  try {
    await browser?.close();
  } finally {
    if (typeof remoteId === "string") await fetch(`${BASE}/api/machines/${encodeURIComponent(remoteId)}`, { method: "DELETE" });
  }
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
