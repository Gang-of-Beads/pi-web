/**
 * Opening the quick switcher is the moment every row is judged by its
 * indicator, so the open must reconcile the browser's status map against the
 * daemon's catalog: the request for `/sessions/statuses` has to fire on every
 * open, and the catalog has to answer with the daemon instance id the browser
 * reconciles against. Without the reconcile the open made no statuses request
 * at all, and a dropped status frame left a finished session marked as
 * waiting until a reload.
 *
 * Usage: node scripts/verify-switcher-reconciles-statuses.mjs [port]
 */
import { openApp, deepClick } from "./lib/liveApp.mjs";

const port = process.argv[2] ?? "8505";
const app = await openApp({ port, phone: true });

const statusesRequests = { on: true, hits: 0 };
let catalogDaemonInstanceId = undefined;
app.page.on("request", (request) => {
  if (!statusesRequests.on) return;
  if (/\/api\/.*\/sessions\/statuses/.test(request.url())) statusesRequests.hits += 1;
});
app.page.on("response", async (response) => {
  if (!/\/api\/.*\/sessions\/statuses/.test(response.url())) return;
  try {
    const body = await response.json();
    if (typeof body?.daemonInstanceId === "string" && body.daemonInstanceId !== "") {
      catalogDaemonInstanceId = body.daemonInstanceId;
    }
  } catch {
    // A non-JSON answer is recorded as absent below.
  }
});

await deepClick(app.page, "open sessions");
await app.page.waitForTimeout(2500);
const firstOpen = statusesRequests.hits;
await app.page.keyboard.press("Escape");
await app.page.waitForTimeout(600);

statusesRequests.hits = 0;
await deepClick(app.page, "open sessions");
await app.page.waitForTimeout(2500);
const secondOpen = statusesRequests.hits;

console.log(`statuses requests: first open=${String(firstOpen)} reopen=${String(secondOpen)} catalog daemonInstanceId=${catalogDaemonInstanceId === undefined ? "absent" : "present"}`);
let failed = false;
if (firstOpen === 0) {
  console.error("FAIL: the first switcher open made no statuses request, so the reconcile is not wired");
  failed = true;
}
if (secondOpen === 0) {
  console.error("FAIL: reopening the switcher made no statuses request, so the reconcile runs only once");
  failed = true;
}
if (catalogDaemonInstanceId === undefined) {
  console.error("FAIL: the statuses catalog carried no daemonInstanceId, so the browser cannot tell a replaced daemon from the same one");
  failed = true;
}
if (failed) {
  process.exitCode = 1;
} else {
  console.log("PASS: every switcher open reconciles statuses against a catalog stamped with the daemon instance");
}
await app.close();
