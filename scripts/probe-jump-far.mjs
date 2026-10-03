import { chromium } from "@playwright/test";

/**
 * The back-to-newest key takes the reader to the newest messages from anywhere in an older window
 * (state-diagram D4), 8505, phone 393x850, the seed session (2,173 messages). Nothing is prompted.
 *
 * Found 2026-10-03 while checking review 754821b2: pressed mid-window after the newest end was
 * dropped from memory, the key asked nothing and moved nothing (0 reads, fromBottom unchanged at
 * 56,856 px), because its newest read went through the forward end's prefetch distance. The probe
 * clears the remembered spot, scrolls up until the newest end is dropped, scrolls back down part
 * of the way, presses the key, and checks that the newest page loads and the reader lands on it.
 */
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const URL = `${BASE}/?project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac&session=01a05000-5eed-7c00-8000-0000000000c1&view=chat`;
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};

const facts = (page) => page.evaluate(() => {
  const app = document.querySelector("pi-web-app");
  const state = app?.state;
  const view = app?.shadowRoot?.querySelector("chat-view");
  const chat = view?.shadowRoot?.querySelector(".chat");
  const key = view?.shadowRoot?.querySelector(".jump-to-bottom");
  const centre = (element) => { const rect = element.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; };
  return {
    start: state?.messagePageStart ?? null,
    end: state?.messagePageEnd ?? null,
    total: state?.messagePageTotal ?? null,
    viewport: view?.viewportState?.kind ?? null,
    fromBottom: chat === null || chat === undefined ? null : chat.scrollHeight - chat.scrollTop - chat.clientHeight,
    key: key === null || key === undefined ? null : centre(key),
    box: chat === null || chat === undefined ? null : centre(chat),
  };
});

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 393, height: 850 } });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(URL);
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith("pi-web:chat-scroll:")) localStorage.removeItem(key); });
  await page.goto(URL);
  await page.waitForTimeout(9000);
  let now = await facts(page);
  check("precondition: the long session opens at its newest end", now.total !== null && now.total > 1000 && now.end === now.total && now.box !== null, JSON.stringify(now));
  await page.mouse.move(now.box.x, now.box.y);
  for (let step = 0; step < 120 && now.end === now.total; step += 1) {
    await page.mouse.wheel(0, -4000);
    await page.waitForTimeout(400);
    now = await facts(page);
  }
  check("precondition: scrolling up dropped the newest end from memory", now.end !== null && now.total !== null && now.end < now.total, JSON.stringify(now));
  for (let step = 0; step < 6; step += 1) {
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(300);
  }
  const before = await facts(page);
  check("precondition: the reader is mid-window, far from its end, with the key shown", before.fromBottom !== null && before.fromBottom > 5000 && before.key !== null && before.end !== null && before.total !== null && before.end < before.total, JSON.stringify(before));
  let reads = 0;
  page.on("request", (request) => { if (/\/sessions\/[^/]+\/messages(?:\?|$)/u.test(request.url())) reads += 1; });
  await page.mouse.click(before.key.x, before.key.y);
  let after = await facts(page);
  for (let waited = 0; waited < 8000 && !(after.end === after.total && after.fromBottom !== null && after.fromBottom <= 48); waited += 250) {
    await page.waitForTimeout(250);
    after = await facts(page);
  }
  check("the key asks for the newest page", reads > 0, JSON.stringify({ reads }));
  check("the reader lands at the newest", after.end === after.total && after.fromBottom !== null && after.fromBottom <= 48, JSON.stringify(after));
  await page.screenshot({ path: "/tmp/surfaces/jump-far-phone.png" });
  await context.close();
} finally {
  await browser.close();
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
