import { chromium } from "@playwright/test";
import { openProbedSession } from "./probeSession.mjs";

// Rasterized truth, not computed styles: three earlier versions of this probe
// read border-radius values back and reported flush corners while the phone
// kept showing notches. The corner is judged by the pixels the browser painted,
// at a phone-like fractional device pixel ratio where the earlier fixes broke.
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const SCALES = [2, 2.625, 3];

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

const browser = await chromium.launch();

async function openTranscript(page) {
  await openProbedSession(page, BASE);
  // openProbedSession already lands in the transcript, so the tile/session
  // clicks the board would have needed are gone.
  // The corner is client-side geometry. The transcript used to be injected as a
  // fixture, but the app re-renders rows from its own store and overwrote it,
  // leaving one card measured at 5,694px tall 90,000px above the viewport. The
  // seeded session always has messages, so the live transcript is the fixture.
  // A probe palette, not the theme's: the review found the classifier blind
  // wherever a header sits within tolerance of the page background (every
  // assistant card in dark theme, every card in light). The probe is judging
  // geometry, so it owns the colors it judges with.
  await page.evaluate(() => {
    const root = document.documentElement.style;
    root.setProperty("--pi-bg", "#000000");
    root.setProperty("--pi-surface", "#00c000");
    root.setProperty("--pi-selection-bg", "#c00000");
    root.setProperty("--pi-border", "#0000c0");
    root.setProperty("--pi-border-muted", "#0000c0");
    root.setProperty("--pi-accent-border", "#0000c0");
  });
  await page.waitForTimeout(800);
}

/**
 * Whether a card's scroll container is the one on screen.
 *
 * The phone layout keeps a second, off-screen copy of the transcript inside the
 * collapsed desktop panel; its cards live ~90,000px away and clipping them gave
 * a one-pixel image. Passed into the page as source, since an evaluate closure
 * does not travel.
 */
/**
 * Whether a card belongs to the transcript the reader is looking at.
 *
 * The phone layout keeps a second, off-screen copy of the transcript in the
 * collapsed desktop panel; its cards sit ~90,000px away, and clipping one gave a
 * one-pixel image. A card whose top is within a screen of the viewport is the
 * real one. Passed into the page as source, since an evaluate closure does not
 * travel.
 */
const ON_SCREEN = `(node) => {
  const box = node.getBoundingClientRect();
  return box.top > -window.innerHeight && box.top < window.innerHeight * 2;
}`;

async function sampleCards(page, scale) {
  // Re-query per card, at use time: a live transcript re-renders and detaches
  // prefetched handles, which the review demonstrated by watching every
  // handle die before sampling. Stale handles fail loudly, but a probe that
  // can only run against a frozen page verifies less than it claims.
  const cardHandle = (at) => page.evaluateHandle(({ index, onScreen }) => {
    const onScreenFn = eval(onScreen);
    function walk(root, out) {
      for (const node of root.querySelectorAll("*")) {
        if (node.matches?.(".msg") && node.querySelector(":scope > .msg-header") !== null) {
          const box = node.getBoundingClientRect();
          if (box.width > 80 && box.height > 30 && onScreenFn(node)) out.push(node);
        }
        if (node.shadowRoot) walk(node.shadowRoot, out);
      }
      return out;
    }
    return walk(document, [])[index] ?? null;
  }, { index: at, onScreen: ON_SCREEN });
  const count = await page.evaluate(({ onScreen }) => {
    const onScreenFn = eval(onScreen);
    function walk(root, out) {
      for (const node of root.querySelectorAll("*")) {
        if (node.matches?.(".msg") && node.querySelector(":scope > .msg-header") !== null && onScreenFn(node)) out.push(node);
        if (node.shadowRoot) walk(node.shadowRoot, out);
      }
      return out;
    }
    return Math.min(walk(document, []).length, 4);
  }, { onScreen: ON_SCREEN });
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const card = await cardHandle(index);
    const element = card.asElement();
    if (element === null) continue;
    try {
      // A card taller than the viewport cannot be centred - its top would stay
      // far above the clip - so tall cards align to the top and short ones
      // centre. Either way the reading is told how much margin survived.
      await element.evaluate((node) => {
        const tall = node.getBoundingClientRect().height > window.innerHeight - 40;
        node.scrollIntoView({ block: tall ? "start" : "center", inline: "nearest" });
      });
    } catch {
      continue;
    }
    await page.waitForTimeout(300);
    const box = await element.boundingBox();
    if (box === null) continue;
    // Inflated by 6 CSS px so the image holds genuinely-outside pixels: the
    // outside reference must not come from a pixel the failure can corrupt.
    // A card scrolled flush to the top would put the clip's y above the viewport
    // and page.screenshot refuses that, so the clip is intersected with the view
    // and the reading is told how much padding survived on each axis.
    const view = page.viewportSize() ?? { width: 393, height: 850 };
    const left = Math.max(0, Math.round(box.x) - 6);
    const top = Math.min(Math.max(0, Math.round(box.y) - 6), view.height - 1);
    const right = Math.min(view.width, Math.round(box.x + box.width) + 6);
    const bottom = Math.max(top + 1, Math.min(view.height, Math.round(box.y + box.height) + 6));
    const padX = Math.round(box.x) - left;
    const padY = Math.round(box.y) - top;
    if (process.env.PROBE_DEBUG_BOX === "1") console.log(`box ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)} -> clip ${left},${top} ${right - left}x${bottom - top}`);
    const shot = await page.screenshot({ clip: { x: left, y: top, width: right - left, height: bottom - top } });
    const reading = await page.evaluate(async ({ png, dpr, padX, padY }) => {
      const image = new Image();
      const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      image.src = `data:image/png;base64,${png}`;
      await loaded;
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pad = Math.round(padX * dpr);
      const padV = Math.round(padY * dpr);
      const pixel = (rawX, rawY) => [...ctx.getImageData(Math.round(rawX), Math.round(rawY), 1, 1).data.slice(0, 3)];
      const close = (a, b, tol = 14) => a.every((channel, i) => Math.abs(channel - b[i]) <= tol);
      const cardW = image.width - 2 * pad;
      const blendOf = (candidate, a, b) => candidate.every((channel, i) => {
        const low = Math.min(a[i], b[i]) - 6;
        const high = Math.max(a[i], b[i]) + 6;
        return channel >= low && channel <= high;
      });
            // The dominant colour of a row, so a glyph landing under the sample does not
      // become the reference. Sampling one pixel at the horizontal centre read the
      // timestamp for short headers and turned every later comparison into a
      // false notch.
      const dominantInRow = (y) => {
        const counts = new Map();
        for (let x = pad + 2; x < image.width - pad - 2; x += 2) {
          const key = pixel(x, y).join(",");
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const [winner] = [...counts.entries()].sort((left, right) => right[1] - left[1]);
        return winner[0].split(",").map(Number);
      };
      // Well inside the header: 4 device px below the top edge still lands in the
      // border band, so the scan never recognised the header it was looking for.
      const header = dominantInRow(padV + 9 * dpr);
      const border = pixel(Math.round(image.width / 2), padV + Math.max(0, Math.round(0.5 * dpr)));
      const outside = pixel(1, 1);
      const cardBody = dominantInRow(Math.min(Math.round(image.height * 0.7), image.height - 2));
      // Walk each top corner's diagonal one device pixel at a time. Outside
      // background is legal before the border band and illegal after it: a
      // pixel of the page showing through between the border arc and the
      // header paint is the notch, whatever subpixel size it has.
      const scan = (fromRight) => {
        const limit = Math.ceil(14 * dpr);
        let borderSeen = false;
        let notch = 0;
        const trail = [];
        for (let step = 0; step < limit; step += 1) {
          const x = fromRight ? pad + cardW - 1 - step : pad + step;
          const sample = pixel(x, padV + step);
          trail.push(sample.join(","));
          if (close(sample, header)) return { ok: notch === 0, notch, trail };
          if (close(sample, border, 24)) { borderSeen = true; continue; }
          const wedge = (close(sample, outside, 24) && !close(outside, header, 24))
            || (close(sample, cardBody, 24) && !close(cardBody, header, 24));
          if (borderSeen && wedge) notch += 1;
        }
        return { ok: false, notch, trail };
      };
      const left = scan(false);
      const right = scan(true);
      // The other failure shape: a square child painting straight over the
      // card's arc. The pixel at the very corner lies outside the rounded
      // border and must never be header paint.
      // 2 CSS px inside the border-box corner is outside the 12px arc but
      // inside a square child's paint: header pixels there mean the child
      // escaped the curve.
      // The very corner, half a CSS pixel in: for any radius above a couple of
      // pixels that point lies outside the arc, so a *solid* fill colour there
      // means the header painted straight over the curve. Two pixels in was
      // inside the arc for the current radius, which made every card a false
      // "notch" the moment the palette gave the header a colour of its own.
      const cornerInset = Math.max(0.5, 1 / dpr);
      const overAt = (x) => close(pixel(x, padV + cornerInset * dpr), header, 20) && !close(pixel(x, padV + cornerInset * dpr), outside, 20);
      const overL = overAt(pad + cornerInset * dpr);
      const overR = overAt(pad + cardW - 1 - cornerInset * dpr);
      if (typeof window !== "undefined") {}
      const dbg = { header, border, outside, cornerL: pixel(pad + 2 * dpr, padV + 2 * dpr), cornerR: pixel(pad + cardW - 1 - 2 * dpr, padV + 2 * dpr), edge: pixel(pad + 2 * dpr, padV + Math.round(8 * dpr)) };
      Reflect.set(window, "probeCornerDebug", dbg);
      return { reference: header, leftOk: left.ok && !overL, rightOk: right.ok && !overR, leftGap: left.notch + (overL ? 100 : 0), rightGap: right.notch + (overR ? 100 : 0), leftTrail: left.trail.slice(0, 18), rightTrail: right.trail.slice(0, 18) };
    }, { png: shot.toString("base64"), dpr: scale, padX, padY });
    results.push(reading);
  }
  return results;
}

try {
  for (const scale of SCALES) {
    const page = await browser.newPage({ viewport: { width: 393, height: 850 }, deviceScaleFactor: scale, colorScheme: 'dark' });
    await openTranscript(page);
    const readings = await sampleCards(page, scale);
    if (readings.length === 0) {
      fail(`dpr ${scale}: no message cards reached - proves nothing`);
    }
    for (const [index, reading] of readings.entries()) {
      const dbg = await page.evaluate(() => Reflect.get(window, "probeCornerDebug"));
      if (process.env.PROBE_DEBUG_BOX === "1") console.log(`dbg ${JSON.stringify(dbg)}`);
      const verdict = reading.leftOk && reading.rightOk ? "ok" : "NOTCH";
      const detail = `gapL ${reading.leftGap} gapR ${reading.rightGap} header ${reading.reference.join(",")}`;
      console.log(`[${verdict}] dpr ${scale} card ${index}: ${detail}`);
      if (verdict !== "ok") fail(`dpr ${scale} card ${index} shows a corner notch`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
