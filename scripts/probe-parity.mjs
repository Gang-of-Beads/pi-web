import { chromium } from "@playwright/test";

// The parity defects were display rules, so they are verified as geometry on
// the live app, at the widths where each was reported.
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? "ok" : "FAIL"}] ${name}: ${detail}`);
}

function deepQueryAllSource() {
  return `(function walk(root, out, selector) {
    for (const node of root.querySelectorAll("*")) {
      if (node.matches?.(selector)) out.push(node);
      if (node.shadowRoot) walk(node.shadowRoot, out, selector);
    }
    return out;
  })`;
}

const browser = await chromium.launch();
try {
  // D3: at 430px every context-bar action stays on the touch floor.
  {
    const page = await browser.newPage({ viewport: { width: 430, height: 850 } });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const sizes = await page.evaluate((walkSource) => {
      const walk = new Function(`return ${walkSource}`)();
      return walk(document, [], ".context-action-button").map((node) => {
        const box = node.getBoundingClientRect();
        return { w: Math.round(box.width), h: Math.round(box.height) };
      });
    }, deepQueryAllSource());
    const below = sizes.filter((size) => size.w < 36 || size.h < 36);
    record(
      "430px: context actions hold the 36px floor",
      sizes.length > 0 && below.length === 0,
      sizes.length === 0 ? "no context actions rendered - proves nothing" : `${String(sizes.length)} buttons, ${String(below.length)} below floor`,
    );
    await page.close();
  }

  // D1 regression: in the 761-1180 band with navigation expanded, the
  // workspace tool tabs (or their replacement) must exist.
  {
    const page = await browser.newPage({ viewport: { width: 900, height: 850 } });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const reachable = await page.evaluate((walkSource) => {
      const walk = new Function(`return ${walkSource}`)();
      const tabs = walk(document, [], "button").filter((node) => {
        const label = (node.getAttribute("aria-label") ?? "") + (node.textContent ?? "");
        return /Files|Terminal|workspace tools|Go to a view/i.test(label) && node.getBoundingClientRect().width > 0;
      });
      return tabs.length;
    }, deepQueryAllSource());
    record("900px: a route to workspace tools exists", reachable > 0, `${String(reachable)} visible controls`);
    await page.close();
  }

  // D5: both modals now share the 760 line (the whitelist test pins the
  // source equality); the live leg verifies the line itself with the dialog
  // that is reachable at a mobile width.
  {
    const page = await browser.newPage({ viewport: { width: 700, height: 850 } });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    // At a mobile width the gear lives behind the actions palette.
    await page.evaluate((walkSource) => {
      const walk = new Function(`return ${walkSource}`)();
      walk(document, [], "button").find((node) => (node.getAttribute("aria-label") ?? "") === "Show Actions")?.click();
    }, deepQueryAllSource());
    await page.waitForTimeout(1000);
    const opened = await page.evaluate((walkSource) => {
      const walk = new Function(`return ${walkSource}`)();
      const settings = walk(document, [], "button, [role='option'], [role='menuitem']").find((node) => /settings/i.test((node.textContent ?? "") + (node.getAttribute("aria-label") ?? "")));
      if (settings === undefined) return false;
      settings.click();
      return true;
    }, deepQueryAllSource());
    await page.waitForTimeout(1500);
    if (!opened) {
      record("700px: dialog full-bleed at the shared line", false, "no settings control reached - proves nothing");
    } else {
      const width = await page.evaluate((walkSource) => {
        const walk = new Function(`return ${walkSource}`)();
        const section = walk(document, [], "modal-surface section[role='dialog']")[0];
        return section === undefined ? undefined : Math.round(section.getBoundingClientRect().width);
      }, deepQueryAllSource());
      record(
        "700px: dialog full-bleed at the shared 760 line",
        width === 700,
        width === undefined ? "dialog did not open - proves nothing" : `dialog width ${String(width)} of 700`,
      );
    }
    await page.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${String(results.length)} checks, ${String(failed)} failing`);
process.exitCode = failed === 0 ? 0 : 1;
