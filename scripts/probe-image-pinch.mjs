#!/usr/bin/env node
/**
 * Does a two-finger pinch zoom the photo preview?
 *
 * Owner request: "照片预览加一个pinch放大缩小功能吧". The preview opens at fit size,
 * which on a phone leaves a screenshot's small print unreadable.
 *
 * Fails loudly: no image, no preview dialog, or no transform change. Pointer
 * events are synthesised (Playwright's touchscreen is single-finger), which
 * exercises the same handlers a real pinch reaches.
 */

import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const PROJECT = process.env.PI_WEB_PROBE_PROJECT ?? "991606fd-e498-4b93-a1ce-2af09efdb0e7";
const WORKSPACE = process.env.PI_WEB_PROBE_WORKSPACE ?? "ef2cdf93e1ac";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
try {
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${SESSION}&view=chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);

  const result = await page.evaluate(async () => {
    const app = document.querySelector("pi-web-app");
    const board = [...app.shadowRoot.querySelectorAll("app-navigate-page")].find((surface) => surface.getBoundingClientRect().width > 0);
    if (board !== undefined) {
      board.shadowRoot.querySelector(".row.session")?.click();
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    const view = app.shadowRoot.querySelector("chat-view");
    const root = view?.shadowRoot;
    const images = [...(root?.querySelectorAll("img.chat-image") ?? [])];
    if (images.length > 0) {
      images[0].click();
    } else {
      // The seed transcript has no picture; open the preview the same way an
      // image click does, with an inline SVG so nothing is fetched.
      const [svg] = ["data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><text x="20" y="60" font-size="40">pinch me</text></svg>')];
      Reflect.apply(Reflect.get(view, "openImageZoom"), view, [svg, "probe"]);
    }
    await new Promise((resolve) => setTimeout(resolve, 600));

    const dialog = root?.querySelector("dialog.image-zoom");
    const full = root?.querySelector("img.image-zoom-full");
    if (dialog === undefined || dialog === null || full === undefined || full === null) return "the preview never opened";
    const at = (x, y) => ({ clientX: x, clientY: y, pointerId: 0, bubbles: true, pointerType: "touch" });
    const send = (type, x, y, pointerId) => {
      dialog.dispatchEvent(new PointerEvent(type, { ...at(x, y), pointerId }));
    };
    const box = dialog.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const scaleOf = () => {
      const match = /scale\(([\d.]+)\)/u.exec(full.getAttribute("style") ?? "");
      return match === null ? 1 : Number(match[1]);
    };
    const before = scaleOf();

    // Two fingers, 60px apart, spreading to 180px.
    send("pointerdown", cx - 30, cy, 11);
    send("pointerdown", cx + 30, cy, 12);
    for (const spread of [90, 120, 150, 180]) {
      send("pointermove", cx - spread / 2, cy, 11);
      send("pointermove", cx + spread / 2, cy, 12);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const zoomed = scaleOf();
    const transform = full.getAttribute("style") ?? "";
    send("pointerup", cx - 90, cy, 11);
    send("pointerup", cx + 90, cy, 12);

    if (!(zoomed > before + 0.5)) return `pinch did not zoom: ${String(before)} -> ${String(zoomed)} (${transform})`;

    // And closing still works after a gesture: the movement must not eat the tap.
    dialog.dispatchEvent(new PointerEvent("pointerdown", { ...at(cx, cy), pointerId: 21 }));
    dialog.dispatchEvent(new PointerEvent("pointerup", { ...at(cx, cy), pointerId: 21 }));
    dialog.dispatchEvent(new MouseEvent("click", { clientX: cx, clientY: cy, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const closed = root?.querySelector("dialog.image-zoom[open]") === null || root?.querySelector("dialog.image-zoom[open]") === undefined;
    if (!closed) return `zoom ${String(zoomed)}x but the tap no longer closes it`;
    return `ok ${String(before)} -> ${zoomed}x, tap still closes`;
  });

  console.log(result);
  if (!result.startsWith("ok")) fail(result);
  else console.log("PASS pinch zooms the preview and a tap still closes it");
} finally {
  await browser.close();
}
