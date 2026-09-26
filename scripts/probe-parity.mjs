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
      // The context bar's own action buttons are gone; the sheet's row action
      // toggles are the controls at this width now.
      // .path-step is a text crumb on the 32px control scale; the action toggles
      // are the controls this check is about.
      const selector = ".context-action-button, .action-menu-toggle";
      return walk(document, [], selector).map((node) => {
        const box = node.getBoundingClientRect();
        return { w: Math.round(box.width), h: Math.round(box.height), cls: String(node.className).slice(0, 40) };
      });
    }, deepQueryAllSource());
    const below = sizes.filter((size) => size.w < 36 || size.h < 36);
    if (below.length > 0) console.log("  below floor:", JSON.stringify(below));
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
    await page.evaluate(() => { document.querySelector("pi-web-app")?.selectMainView?.("navigation"); });
    await page.waitForTimeout(1200);
    const opened = await page.evaluate((walkSource) => {
      const walk = new Function(`return ${walkSource}`)();
      // The board's own gear, by its aria-label: a text match found a hidden copy.
      const gear = walk(document, [], "app-navigate-page").flatMap((board) => [...(board.shadowRoot?.querySelectorAll("button.settings") ?? [])])[0];
      const settings = gear ?? walk(document, [], "button, [role='option'], [role='menuitem']").find((node) => /settings/i.test((node.textContent ?? "") + (node.getAttribute("aria-label") ?? "")));
      if (settings === undefined) return false;
      settings.click();
      return true;
    }, deepQueryAllSource());
    await page.waitForTimeout(1500);
    if (opened) console.log("  after click:", JSON.stringify(await page.evaluate(() => { const app = document.querySelector("pi-web-app"); const walk = (r, out = []) => { for (const n of r.querySelectorAll("*")) { if (/dialog|sheet/i.test(n.localName + String(n.className))) out.push(n.localName + "." + String(n.className).slice(0, 24) + ":" + Math.round(n.getBoundingClientRect().width)); if (n.shadowRoot) walk(n.shadowRoot, out); } return out; }; return { view: app?.state?.mainView, dialogs: walk(document).slice(0, 6) }; })));
    if (!opened) {
      console.log("  settings lookup:", JSON.stringify(await page.evaluate(() => { const app = document.querySelector("pi-web-app"); return { view: app?.state?.mainView, buttons: [...document.querySelectorAll("button")].length }; })));
      record("700px: dialog full-bleed at the shared line", false, "no settings control reached - proves nothing");
    } else {
      const width = await page.evaluate((walkSource) => {
        const walk = new Function(`return ${walkSource}`)();
        // The settings surface is its own element now (a full-height page on a
        // narrow screen, a dialog on a wide one); the old inner section selector
        // matched nothing, which read as "did not open".
        const surface = walk(document, [], "settings-dialog, [role='dialog'], .modal-surface").find((node) => node.getBoundingClientRect().width > 0);
        return surface === undefined ? undefined : Math.round(surface.getBoundingClientRect().width);
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
