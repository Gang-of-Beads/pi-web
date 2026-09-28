/**
 * A streaming session must not drag the reader along, and must not flicker.
 *
 * The owner opened his `trade` session on the desktop and it scrolled and flickered
 * on its own, unstoppably - the jump-to-bottom arrow did not win either. This probe
 * measures the live session: frames, DOM mutations, and which way the scroll goes
 * when nobody touches it, then whether an upward wheel is respected.
 */
import { chromium } from "playwright";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8504";
const PROJECT = process.env.PROBE_PROJECT ?? "14a415fc-b819-4c33-a582-cc5ad06fef4a";
const SESSION = process.env.PROBE_SESSION ?? "01a059d4-8aa8-7c5c-ab8e-4f5c7ccc9ef6";
const trackCwd = process.env.PROBE_CWD ?? "/Users/hanxiao.du/Desktop/vincent/projects/trade";
const WATCH_FOR_MS = Number(process.env.PROBE_WATCH_MS ?? 8000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${BASE}/?project=${PROJECT}&session=${SESSION}&view=chat`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const install = () => page.evaluate(() => {
  const scroller = (() => {
    let best = null;
    const walk = (root) => {
      for (const node of root.querySelectorAll("*")) {
        if (node.scrollHeight > node.clientHeight + 40 && getComputedStyle(node).overflowY !== "visible") {
          if (best === null || node.scrollHeight > best.scrollHeight) best = node;
        }
        if (node.shadowRoot !== null && node.shadowRoot !== undefined) walk(node.shadowRoot);
      }
    };
    walk(document);
    return best;
  })();
  if (scroller === null) return { found: false };
  window.__probe = { scroller, frames: 0, mutations: 0, samples: [] };
  const tick = () => { window.__probe.frames += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const observer = new MutationObserver((records) => { window.__probe.mutations += records.length; });
  const chat = (() => {
    let found = null;
    const walk = (root) => {
      for (const node of root.querySelectorAll("*")) {
        if (node.localName === "chat-view") found = node;
        if (node.shadowRoot !== null && node.shadowRoot !== undefined) walk(node.shadowRoot);
      }
    };
    walk(document);
    return found;
  })();
  observer.observe(chat ?? document.body, { childList: true, characterData: true, subtree: true });
  window.__probe.sampler = setInterval(() => {
    window.__probe.samples.push([Math.round(performance.now()), Math.round(window.__probe.scroller.scrollTop), window.__probe.scroller.scrollHeight]);
  }, 100);
  const app = document.querySelector("pi-web-app");
  return { found: true, streaming: app?.state?.selectedSessionStreaming ?? null, messages: app?.state?.chatMessages?.length ?? null };
});

const state = await install();
console.log("watch:", JSON.stringify(state));
if (!state.found) { console.log("FAIL no scroll container found"); await browser.close(); process.exit(1); }

await page.waitForTimeout(WATCH_FOR_MS);
const idle = await page.evaluate(() => {
  const probe = window.__probe;
  return { frames: probe.frames, mutations: probe.mutations, samples: probe.samples.splice(0) };
});
const heights = new Set(idle.samples.map((sample) => sample[2]));
const tops = idle.samples.map((sample) => sample[1]);
const moved = Math.max(...tops) - Math.min(...tops);
const grew = Math.max(...heights) - Math.min(...heights);
console.log(`idle ${WATCH_FOR_MS}ms: frames=${idle.frames} mutations=${idle.mutations} scrollMoved=${moved}px contentGrew=${grew}px distinctHeights=${heights.size}`);

await page.mouse.move(640, 450);
await page.mouse.wheel(0, -700);
// Let the wheel finish before sampling, or the samples straddle it and the "drift"
// is just the wheel itself.
await page.waitForTimeout(700);
await page.evaluate(() => { window.__probe.samples.splice(0); });
await page.waitForTimeout(1500);
const afterWheel = await page.evaluate(() => {
  const probe = window.__probe;
  return { top: Math.round(probe.scroller.scrollTop), height: probe.scroller.scrollHeight, samples: probe.samples.splice(0) };
});
const wheelTops = afterWheel.samples.map((sample) => sample[1]);
const drift = wheelTops.length === 0 ? 0 : Math.max(...wheelTops) - Math.min(...wheelTops);
console.log(`after wheel up: top=${afterWheel.top} height=${afterWheel.height} driftOver1.2s=${drift}px`);
if (drift > 400) console.log(`FAIL the reader was dragged ${drift}px after scrolling up - the pin did not release`);

if (process.env.PROBE_STREAM === "1") {
  const sent = await page.evaluate(async ({ base, project, session, cwd }) => {
    const response = await fetch(`${base}/api/sessions/${session}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, text: "Reply with three short lines and nothing else." }),
    });
    void project;
    return response.status;
  }, { base: BASE, project: PROJECT, session: SESSION, cwd: trackCwd });
  console.log("prompt sent:", sent);
  const streamMs = Number(process.env.PROBE_STREAM_MS ?? 25000);
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.__probe.samples.splice(0); window.__probe.frames = 0; window.__probe.mutations = 0; });
  await page.waitForTimeout(streamMs);
  const streaming = await page.evaluate(() => {
    const probe = window.__probe;
    const app = document.querySelector("pi-web-app");
    return {
      frames: probe.frames,
      mutations: probe.mutations,
      samples: probe.samples.splice(0),
      pinned: app?.state?.jumpToBottomVisible ?? null,
    };
  });
  const tops = streaming.samples.map((sample) => sample[1]);
  const heights = streaming.samples.map((sample) => sample[2]);
  const seconds = Number(process.env.PROBE_STREAM_MS ?? 25000) / 1000;
  console.log(`streaming ${seconds}s: frames=${streaming.frames} mutations=${streaming.mutations} scrollMoved=${Math.max(...tops) - Math.min(...tops)}px contentGrew=${Math.max(...heights) - Math.min(...heights)}px`);
  console.log("frames per second:", Math.round(streaming.frames / seconds), "· mutations per second:", Math.round(streaming.mutations / seconds));

  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(900);
  await page.evaluate(() => { window.__probe.samples.splice(0); });
  await page.waitForTimeout(2500);
  const held = await page.evaluate(() => {
    const probe = window.__probe;
    const app = document.querySelector("pi-web-app");
    return { samples: probe.samples.splice(0), jump: app?.state?.jumpToBottomVisible ?? null };
  });
  const heldTops = held.samples.map((sample) => sample[1]);
  const heldHeights = held.samples.map((sample) => sample[2]);
  const heldDrift = heldTops.length === 0 ? 0 : Math.max(...heldTops) - Math.min(...heldTops);
  console.log(`after an upward wheel while streaming: drift=${heldDrift}px contentGrew=${Math.max(...heldHeights) - Math.min(...heldHeights)}px jumpOffered=${String(held.jump)}`);
  if (heldDrift > 300) console.log(`FAIL the reader was dragged ${heldDrift}px while streaming`);
  else console.log("holding position while it streams", held.jump === true ? "(jump-to-bottom offered)" : "(no jump affordance)");
}

const jump = await page.evaluate(() => {
  const app = document.querySelector("pi-web-app");
  return app?.state?.jumpToBottomVisible ?? null;
});
console.log("jump-to-bottom offered:", String(jump));

await browser.close();
