/**
 * Shared browser entry for the verification scripts.
 *
 * Deep links do not restore a session, so every script that needs a real
 * conversation has to walk in the way a reader does: project, workspace, then
 * the session with the most to show.
 */
import { chromium, devices } from "@playwright/test";

const CHROMIUM = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

export async function openApp({ port = "8504", phone = false } = {}) {
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const context = await browser.newContext(
    phone ? { ...devices["Pixel 5"], colorScheme: "dark" } : { viewport: { width: 1440, height: 900 }, colorScheme: "dark" },
  );
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  return { browser, context, page, close: async () => { await context.close(); await browser.close(); } };
}

/**
 * Source for page-side use: a scroller reports rectangles for children it has
 * clipped away, so any measurement of "what is on screen" has to intersect a
 * candidate with its scrolling ancestor before believing its rectangle.
 */
export const VISIBLE_IN_SCROLLER_FN = `
function visibleInScroller(el, scroller) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const view = scroller?.getBoundingClientRect();
  if (view && (r.bottom <= view.top || r.top >= view.bottom)) return false;
  return r.top >= 0 && r.bottom <= window.innerHeight;
}
`;

/** Every element matching `match`, across shadow roots. */
export function deepQuery(page, selector, matchText) {
  return page.evaluate(
    ({ selector: sel, matchText: text }) => {
      const hits = [];
      const walk = (root) => {
        for (const el of root.querySelectorAll(sel)) {
          const label = `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`.trim();
          if (text === undefined || label.toLowerCase().includes(text.toLowerCase())) {
            const r = el.getBoundingClientRect();
            hits.push({ label: label.slice(0, 40), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
          }
        }
        for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
      };
      walk(document);
      return hits;
    },
    { selector, matchText },
  );
}

/** Click the first element whose accessible name or text contains `text`. */
export function deepClick(page, text, selector = "button, [role='button'], [role='listitem'], li, a") {
  return page.evaluate(
    ({ selector: sel, text: needle }) => {
      const walk = (root) => {
        for (const el of root.querySelectorAll(sel)) {
          const label = `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`.toLowerCase();
          if (label.includes(needle.toLowerCase())) { el.click(); return true; }
        }
        for (const el of root.querySelectorAll("*")) if (el.shadowRoot && walk(el.shadowRoot)) return true;
        return false;
      };
      return walk(document);
    },
    { selector, text },
  );
}

/**
 * Walk into the busiest session. Returns the session's label, or undefined
 * when no conversation could be reached - callers must treat that as a failed
 * precondition rather than a pass.
 */
export async function enterBusiestSession(page, { project = "pi-web" } = {}) {
  await deepClick(page, project);
  await page.waitForTimeout(2000);
  await deepClick(page, "main");
  await page.waitForTimeout(2500);

  const sessions = await page.evaluate(() => {
    const found = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll("[role='listitem'], li, button")) {
        const text = (el.textContent ?? "").trim();
        const count = /(\d+)\s+messages/u.exec(text);
        if (count) found.push({ text: text.slice(0, 40), count: Number(count[1]) });
      }
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    return found.sort((a, b) => b.count - a.count);
  });

  const busiest = sessions[0];
  if (busiest === undefined) return undefined;

  await deepClick(page, busiest.text.split("\n")[0].slice(0, 20));
  await page.waitForTimeout(4000);

  const reached = await page.evaluate(() => document.querySelector("pi-web-app")?.shadowRoot?.querySelector("chat-view") !== null);
  return reached ? busiest.text : undefined;
}
