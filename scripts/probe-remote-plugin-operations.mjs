import { chromium } from "@playwright/test";

/**
 * A remote machine's plugins reach their own machine (B50), 8505, phone 393x850.
 *
 * A machine-scoped registration posted its operations as `api/plugins/machine.<hex>.<id>/<op>` to
 * the gateway's daemon, which only knows its own catalog's ids and answered 404. A remote machine's
 * goals list, voice token and update offer failed. The probe adds 8505 to its own roster as a remote
 * machine (removed at the end, as in probe-boot-reads.mjs) and opens it.
 * Legs:
 * - every plugin operation sent by the remote machine's registrations is answered with 2xx;
 * - they travel the machine's own path, `api/machines/<id>/plugins/<source id>/<op>`.
 * Controls: the remote machine is selected, its updates plugin is registered, and at least one
 * operation was sent for it (the updates plugin asks `offer.answered` when it activates).
 * Nothing is answered or recorded: the probe never closes an offer.
 */
const BASE = "http://127.0.0.1:8505";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};

const added = await fetch(`${BASE}/api/machines`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "probe-remote-operations", baseUrl: `${BASE}/` }) });
const addedBody = added.ok ? await added.json() : undefined;
const remoteId = addedBody?.machine?.id ?? addedBody?.id;
check("precondition: 8505 is on its own roster as a remote machine", typeof remoteId === "string", `${String(added.status)} ${String(remoteId)}`);
const browser = await chromium.launch();
try {
  if (typeof remoteId === "string") {
    const hex = Buffer.from(remoteId).toString("hex");
    const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
    await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    const operations = [];
    page.on("response", (response) => {
      const request = response.request();
      if (request.method() !== "POST") return;
      const path = new URL(response.url()).pathname;
      const legacy = path.startsWith(`/api/plugins/machine.${hex}.`);
      const own = path.startsWith(`/api/machines/${encodeURIComponent(remoteId)}/plugins/`);
      if (legacy || own) operations.push({ path, status: response.status(), own });
    });
    await page.goto(`${BASE}/?machine=${encodeURIComponent(remoteId)}`);
    await page.waitForTimeout(9_000);
    const held = await page.evaluate((id) => {
      const app = document.querySelector("pi-web-app");
      return {
        selected: app?.state?.selectedMachine?.id ?? null,
        remoteUpdates: [...(app?.plugins?.pluginIds ?? [])].some((pluginId) => String(pluginId).endsWith(".updates") && String(pluginId) !== "updates"),
        id,
      };
    }, remoteId);
    await context.close();
    check("control: the remote machine is selected, its updates plugin is registered, and it sent an operation", held.selected === remoteId && held.remoteUpdates && operations.length > 0, JSON.stringify({ selected: held.selected, remoteUpdates: held.remoteUpdates, operations: operations.length }));
    check("every operation the remote machine's plugins sent was answered", operations.length > 0 && operations.every((operation) => operation.status >= 200 && operation.status < 300), JSON.stringify(operations.map((operation) => `${operation.path.split("/").slice(-2).join("/")} ${String(operation.status)}`)));
    check("they travelled the machine's own path", operations.length > 0 && operations.every((operation) => operation.own), JSON.stringify(operations.map((operation) => operation.path)));
  }
} finally {
  await browser.close();
  if (typeof remoteId === "string") await fetch(`${BASE}/api/machines/${encodeURIComponent(remoteId)}`, { method: "DELETE" });
}
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
