/**
 * PROBE (not a regression check): while a reply streams into the transcript,
 * does anything the reader might be aiming at move?
 *
 * The owner reported "I have to tap twice" six times, and the mechanism that
 * finally explained it was movement between touchend and click - a question
 * card drawn at the end of the transcript was pushed by every arriving token.
 * The card was moved into its own layout row (`.waiting-slot`), outside the
 * scroller, precisely so that nothing arriving can move it. This probe holds
 * that claim against the built bundle: it mounts the real chat-view with an
 * open dialog, then streams messages in, toggles the queued strip, and grows
 * the dock's elapsed label, sampling geometry every 100ms the whole time.
 *
 * PASS is every sampled delta at exactly 0px for the waiting slot and the
 * dock row's top. A probe that cannot meet its preconditions (component not
 * mounted, slot absent, zero samples) FAILS loudly rather than passing empty.
 *
 * Usage: node scripts/probe-waiting-stability.mjs   (8505 stack must be up)
 */
import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const SCREENS = [
  { name: "coarse 393x850", viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true },
  { name: "fine 1440x900", viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false },
];
const STREAM_MS = 3000;
const SAMPLE_MS = 100;

const PAGE = (entry) => `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  html,body{margin:0;background:#111;color:#eee;font:14px system-ui,sans-serif}
  #frame{display:flex;flex-direction:column;height:100vh}
  chat-view{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
  #composer{flex:0 0 auto;height:56px;background:#222}
</style></head><body>
  <div id="frame">
    <chat-view id="view"></chat-view>
    <div id="composer"></div>
  </div>
  <script type="module">
    import "${entry}";
    const view = document.getElementById("view");
    view.sessionId = "probe";
    view.messages = [
      { role: "user", parts: [{ type: "text", text: "Start" }] },
      { role: "assistant", parts: [{ type: "text", text: "Streaming reply begins" }] },
    ];
    view.pendingAsk = {
      askId: "probe-ask",
      askedAt: "2026-08-30T18:00:00.000Z",
      questions: [{ id: "q1", question: "Pick one while the reply streams", options: [{ value: "alpha", label: "Alpha" }, { value: "beta", label: "Beta" }] }],
    };
    view.status = {
      sessionId: "probe", isStreaming: true, isCompacting: false, isBashRunning: false,
      pendingMessageCount: 0, queuedMessages: [],
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0,
    };
    window.__view = view;
    window.__ready = true;
  </script>
</body></html>`;

/** One geometry sample; null boxes mean the element is absent this beat. */
const SAMPLE = () => {
  const view = window.__view;
  const root = view.renderRoot ?? view.shadowRoot;
  const box = (el) => {
    if (el === null || el === undefined) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), height: Math.round(r.height) };
  };
  const slot = root.querySelector(".waiting-slot");
  // The ask card's options are radio inputs inside labels — the tap target is
  // the first option's input.
  const firstButton = slot?.querySelector("ask-user-card")?.shadowRoot?.querySelector(".option input");
  return {
    slot: box(slot),
    firstOption: box(firstButton ?? null),
    dock: box(root.querySelector(".activity-dock")),
    composer: box(document.getElementById("composer")),
  };
};

async function main() {
  const browser = await chromium.launch({ executablePath: EXE });
  try {
    const index = await (await fetch("http://127.0.0.1:8505/")).text();
    const entry = /src="([^"]*index-[^"]*\.js)"/u.exec(index)?.[1];
    if (entry === undefined) {
      console.log("FAIL: could not find the client entry bundle in index.html");
      process.exitCode = 1;
      return;
    }
    const entryUrl = entry.startsWith("http") ? entry : `/${entry.replace(/^\.?\//u, "")}`;
    console.log(`entry   : ${entryUrl}`);
    let failed = false;
    for (const screen of SCREENS) {
      const context = await browser.newContext({ viewport: screen.viewport, hasTouch: screen.hasTouch, isMobile: screen.isMobile });
      const page = await context.newPage();
      await page.route("**/probe.html", (route) => {
        route.fulfill({ status: 200, contentType: "text/html", body: PAGE(entryUrl) });
      });
      await page.goto("http://127.0.0.1:8505/probe.html", { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 15000 });
      await page.waitForTimeout(400);

      // Drive the stream from the page: append a message and grow the last one
      // every 150ms, and flip the queued strip on and off, for STREAM_MS.
      await page.evaluate(({ streamMs }) => {
        const view = window.__view;
        let beat = 0;
        window.__driver = setInterval(() => {
          beat += 1;
          const grown = [...view.messages];
          const last = grown[grown.length - 1];
          grown[grown.length - 1] = { ...last, parts: [{ type: "text", text: `${last.parts[0].text} token${beat}` }] };
          if (beat % 3 === 0) grown.push({ role: "assistant", parts: [{ type: "text", text: `New paragraph ${beat}` }] });
          view.messages = grown;
          view.status = {
            ...view.status,
            queuedMessages: beat % 4 < 2 ? [] : [{ text: `queued ${beat}`, kind: "followUp" }],
          };
        }, 150);
        setTimeout(() => clearInterval(window.__driver), streamMs);
      }, { streamMs: STREAM_MS });

      const samples = [];
      const beats = Math.floor(STREAM_MS / SAMPLE_MS);
      for (let i = 0; i < beats; i += 1) {
        samples.push(await page.evaluate(SAMPLE));
        await page.waitForTimeout(SAMPLE_MS);
      }
      await context.close();

      if (samples.length === 0 || samples[0].slot === null || samples[0].firstOption === null) {
        console.log(`${screen.name}: FAIL(precondition) - waiting slot or its option never rendered`);
        failed = true;
        continue;
      }
      const spread = (key) => {
        const tops = samples.filter((s) => s[key] !== null).map((s) => s[key].top);
        return { seen: tops.length, delta: Math.max(...tops) - Math.min(...tops) };
      };
      const slot = spread("slot");
      const option = spread("firstOption");
      const dock = spread("dock");
      const composer = spread("composer");
      const absentBeats = samples.filter((s) => s.slot === null).length;
      console.log(`${screen.name}: samples=${samples.length} slotTopDelta=${slot.delta}px optionTopDelta=${option.delta}px dockTopDelta=${dock.delta}px (dock seen ${dock.seen}) composerTopDelta=${composer.delta}px slotAbsentBeats=${absentBeats}`);
      if (slot.delta !== 0 || option.delta !== 0 || composer.delta !== 0 || absentBeats > 0) {
        console.log(`${screen.name}: FAIL - something the reader could be aiming at moved during the stream`);
        failed = true;
      }
    }
    process.exitCode = failed ? 1 : 0;
    console.log(failed ? "RESULT: FAIL" : "RESULT: PASS - nothing aimable moved while the reply streamed");
  } finally {
    await browser.close();
  }
}

await main();
