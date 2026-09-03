import { chromium } from "@playwright/test";

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
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const tapped = await page.evaluate(() => {
    function walk(root, out) {
      for (const node of root.querySelectorAll("*")) {
        if (node.matches?.("a, button, [role='button']")) {
          const text = (node.textContent ?? "").trim();
          if ((text.startsWith("test") || text.startsWith("pi-web")) && node.getBoundingClientRect().width > 0) out.push(node);
        }
        if (node.shadowRoot) walk(node.shadowRoot, out);
      }
      return out;
    }
    const hit = walk(document, [])[0];
    if (hit === undefined) return false;
    hit.click();
    return true;
  });
  if (!tapped) console.log("note: could not open a project");
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    function walk(root, out) {
      for (const node of root.querySelectorAll("*")) {
        if (node.matches?.("button") && (node.textContent ?? "").trim().startsWith("Session")) out.push(node);
        if (node.shadowRoot) walk(node.shadowRoot, out);
      }
      return out;
    }
    walk(document, [])[0]?.click();
  });
  await page.waitForTimeout(2500);
  // The corner is client-side geometry, so the transcript is a fixture: the
  // probe must not depend on some session happening to hold messages.
  await page.evaluate(async () => {
    function walk(root, out) {
      for (const node of root.querySelectorAll("*")) {
        if (node.localName === "chat-view") out.push(node);
        if (node.shadowRoot) walk(node.shadowRoot, out);
      }
      return out;
    }
    const chat = walk(document, [])[0];
    if (chat === undefined) throw new Error("no chat-view on this surface - proves nothing");
    chat.messages = [
      { role: "user", parts: [{ type: "text", text: "corner probe: a user message long enough to wrap onto a second line on a phone viewport." }] },
      { role: "assistant", parts: [{ type: "text", text: "corner probe: an assistant reply." }] },
      { role: "user", parts: [{ type: "text", text: "corner probe: second user message." }] },
      { role: "assistant", parts: [{ type: "text", text: "corner probe: second assistant reply." }] },
    ];
    await chat.updateComplete;
  });
  await page.waitForTimeout(800);
}

async function sampleCards(page, scale) {
  const cards = await page.evaluateHandle(() => {
    function walk(root, out) {
      for (const node of root.querySelectorAll("*")) {
        if (node.matches?.(".msg") && node.querySelector(":scope > .msg-header") !== null) {
          const box = node.getBoundingClientRect();
          if (box.width > 80 && box.height > 30) out.push(node);
        }
        if (node.shadowRoot) walk(node.shadowRoot, out);
      }
      return out;
    }
    return walk(document, []).slice(0, 4);
  });
  const count = await page.evaluate((list) => list.length, cards);
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const card = await page.evaluateHandle(({ list, at }) => list[at], { list: cards, at: index });
    const element = card.asElement();
    if (element === null) continue;
    try {
      await element.scrollIntoViewIfNeeded({ timeout: 4000 });
    } catch {
      continue;
    }
    await page.waitForTimeout(300);
    const box = await element.boundingBox();
    if (box === null) continue;
    // Inflated by 6 CSS px so the image holds genuinely-outside pixels: the
    // outside reference must not come from a pixel the failure can corrupt.
    const shot = await page.screenshot({ clip: { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: Math.min(box.height + 12, 820) } });
    const reading = await page.evaluate(async ({ png, dpr }) => {
      const image = new Image();
      const loaded = new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      image.src = `data:image/png;base64,${png}`;
      await loaded;
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pad = Math.round(6 * dpr);
      const pixel = (rawX, rawY) => [...ctx.getImageData(Math.round(rawX), Math.round(rawY), 1, 1).data.slice(0, 3)];
      const close = (a, b, tol = 14) => a.every((channel, i) => Math.abs(channel - b[i]) <= tol);
      const cardW = image.width - 2 * pad;
      const blendOf = (candidate, a, b) => candidate.every((channel, i) => {
        const low = Math.min(a[i], b[i]) - 6;
        const high = Math.max(a[i], b[i]) + 6;
        return channel >= low && channel <= high;
      });
      const header = pixel(image.width / 2, pad + 4 * dpr);
      const border = pixel(Math.round(image.width / 2), pad + Math.max(0, Math.round(0.5 * dpr)));
      const outside = pixel(1, 1);
      const cardBody = pixel(Math.round(image.width / 2), Math.round(image.height * 0.7));
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
          const sample = pixel(x, pad + step);
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
      const overAt = (x) => close(pixel(x, pad + 2 * dpr), header) && !close(outside, header, 24);
      const overL = overAt(pad + 2 * dpr);
      const overR = overAt(pad + cardW - 1 - 2 * dpr);
      return { reference: header, leftOk: left.ok && !overL, rightOk: right.ok && !overR, leftGap: left.notch + (overL ? 100 : 0), rightGap: right.notch + (overR ? 100 : 0), leftTrail: left.trail.slice(0, 18), rightTrail: right.trail.slice(0, 18) };
    }, { png: shot.toString("base64"), dpr: scale });
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
