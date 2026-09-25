import { chromium } from "@playwright/test";

const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";

const link = `${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`;

function fail(message) {
  console.log(`FAIL ${message}`);
  process.exitCode = 1;
}

const readView = (page) => page.evaluate(() => {
  const state = Reflect.get(document.querySelector("pi-web-app"), "state");
  return {
    view: state?.mainView ?? null,
    session: state?.selectedSession?.id ?? null,
    cardWidth: (() => {
      const out = [];
      const walk = (root) => {
        for (const node of root.querySelectorAll("*")) {
          if (node.matches?.(".msg")) out.push(Math.round(node.getBoundingClientRect().width));
          if (node.shadowRoot) walk(node.shadowRoot);
        }
      };
      walk(document);
      return out;
    })(),
  };
});

const browser = await chromium.launch();
try {
  for (const [label, options] of [
    ["393x850", { viewport: { width: 393, height: 850 } }],
    ["393x850 touch", { viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true }],
    ["1280x800", { viewport: { width: 1280, height: 800 } }],
  ]) {
    const page = await browser.newPage(options);
    await page.goto(link, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3200);
    const state = await readView(page);
    if (state.session !== SESSION) {
      fail(`${label}: the link did not select the session (${String(state.session)}) - proves nothing`);
      await page.close();
      continue;
    }
    if (state.view !== "chat") {
      fail(`${label}: a link naming a session opened "${String(state.view)}" instead of the conversation`);
      await page.close();
      continue;
    }
    const widest = state.cardWidth.length === 0 ? 0 : Math.max(...state.cardWidth);
    if (widest < 80) {
      fail(`${label}: the conversation is the main view but no message card is laid out (widest ${String(widest)}px)`);
      await page.close();
      continue;
    }
    console.log(`ok ${label}: link opens the conversation, widest card ${String(widest)}px`);
    await page.close();
  }
  if (process.exitCode === undefined) console.log("PASS a phone-sized deep link opens the conversation it names");
} finally {
  await browser.close();
}
