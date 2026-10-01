import { chromium } from "@playwright/test";

/**
 * An open reads the session once (state-diagram D5, "An open reads the session once"; P3 slice c).
 *
 * Opens the small seed session by link at 393x850, cold (its runtime stopped first, so the open
 * raises the 8505 extensions' startup dialogs) and then warm, and counts the reads of that session
 * made in the first 8 s. Budget: 1 transcript tail, 1 status, no stream sync; the startup dialogs
 * still show.
 */
const BASE = "http://127.0.0.1:8505";
const CWD = "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const SESSION = "01a05000-5eed-7c00-8000-0000000000e1";
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : ` (${detail})`}`);
};

async function open(label) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
    await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    const reads = { status: 0, sync: 0, tail: 0, messages: 0, snapshot: 0 };
    const dialogFrames = [];
    page.on("request", (request) => {
      const url = request.url();
      if (!url.includes(`/sessions/${SESSION}/`)) return;
      if (/\/status(\?|$)/u.test(url)) reads.status += 1;
      else if (/stream-snapshot\?.*sinceSeq/u.test(url)) reads.sync += 1;
      else if (/stream-snapshot/u.test(url)) reads.snapshot += 1;
      else if (/transcript-tail/u.test(url)) reads.tail += 1;
      else if (/\/messages/u.test(url)) reads.messages += 1;
    });
    page.on("websocket", (socket) => {
      if (!socket.url().includes(`/sessions/${SESSION}/events`)) return;
      socket.on("framereceived", ({ payload }) => {
        try {
          const frame = JSON.parse(String(payload));
          if (frame.type === "dialog.opened") dialogFrames.push(frame.revision);
        } catch { /* not a JSON frame */ }
      });
    });
    await page.goto(`${BASE}/?project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac&session=${SESSION}`);
    await page.waitForTimeout(8_000);
    const shown = await page.evaluate(() => {
      const state = document.querySelector("pi-web-app")?.state;
      return { selected: state?.selectedSession?.id, dialogs: (state?.pendingDialogs ?? []).length };
    });
    console.log(`${label}: ${JSON.stringify({ reads, dialogFrames, shown })}`);
    return { reads, dialogFrames, shown };
  } finally {
    await browser.close();
  }
}

const stopped = await fetch(`${BASE}/api/sessions/${SESSION}/stop`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: CWD }) });
check("precondition: the session's runtime was stopped, so the first open is cold", stopped.status === 200, `status ${String(stopped.status)}`);
const cold = await open("cold");
check("precondition cold: the session opened", cold.shown.selected === SESSION, String(cold.shown.selected));
check("precondition cold: the opening runtime raised a startup dialog during the open", cold.dialogFrames.length >= 1, JSON.stringify(cold.dialogFrames));
check("cold: one transcript tail and one status, no stream sync, no fallback reads", cold.reads.tail === 1 && cold.reads.status === 1 && cold.reads.sync === 0 && cold.reads.messages === 0 && cold.reads.snapshot === 0, JSON.stringify(cold.reads));
check("cold: the startup dialogs show", cold.shown.dialogs === cold.dialogFrames.length || cold.shown.dialogs >= 1, `shown ${String(cold.shown.dialogs)}`);
const warm = await open("warm");
check("precondition warm: the session opened", warm.shown.selected === SESSION, String(warm.shown.selected));
check("warm: one transcript tail and one status, no stream sync", warm.reads.tail === 1 && warm.reads.status === 1 && warm.reads.sync === 0, JSON.stringify(warm.reads));
const failed = results.filter((result) => !result.pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
