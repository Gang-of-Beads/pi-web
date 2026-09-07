import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.LAYOUT_BASE ?? "http://127.0.0.1:8505";
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const OUT = "/tmp/layout-research";
mkdirSync(`${OUT}/mobile`, { recursive: true });
mkdirSync(`${OUT}/desktop`, { recursive: true });

/* Deep-shadow utilities: every component renders into a shadow root. */
const deepTap = (label) => `(function(){
  var hit=null;
  var walk=function(root){var els=root.querySelectorAll("button, [role=button], li, a");for(var j=0;j<els.length;j++){var t=(els[j].getAttribute("aria-label")||els[j].textContent||"").trim();if(hit===null&&t.indexOf(${JSON.stringify(label)})!==-1){hit=els[j];}}var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};
  walk(document);
  if(!hit)return false;hit.click();return true;
})()`;
const deepAll = (selector) => `(function(){
  var out=[];
  var walk=function(root){var found=root.querySelectorAll(${JSON.stringify(selector)});for(var j=0;j<found.length;j++)out.push(found[j]);var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};
  walk(document);
  return out;
})()`;
const metrics = `(function(){
  var rows=[];
  var walk=function(root){var els=root.querySelectorAll("button, a, [role=button], [role=tab], input, textarea, select");
    for(var j=0;j<els.length;j++){var el=els[j];var r=el.getBoundingClientRect();
      if(r.width===0&&r.height===0)continue;
      rows.push({tag:el.tagName.toLowerCase(),label:(el.getAttribute("aria-label")||el.textContent||el.getAttribute("placeholder")||"").trim().slice(0,40),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)});}
    var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};
  walk(document);
  return rows;
})()`;
const shot = async (page, dir, name) => {
  await page.screenshot({ path: `${OUT}/${dir}/${name}.png` });
  const rows = await page.evaluate(metrics);
  const interactive = rows.filter((r) => r.tag === "button" || r.tag === "a");
  const inputs = rows.filter((r) => !(r.tag === "button" || r.tag === "a"));
  const smallInteractive = interactive.filter((r) => r.h < 44 || r.w < 44).sort((a, b) => a.w * a.h - b.w * b.h);
  const smallInputs = inputs.filter((r) => r.h < 44 || r.w < 44).sort((a, b) => a.w * a.h - b.w * b.h);
  return { name, elements: rows.length, under44: smallInteractive, inputsUnder44: smallInputs };
};

const run = [];
const capture = async (page, dir, name) => { run.push(await shot(page, dir, name)); console.log(`captured ${dir}/${name} — ${run[run.length - 1].elements} interactive elements, ${run[run.length - 1].under44.length} under 44px`); };

const browser = await chromium.launch({ executablePath: EXE, headless: true });
try {
  for (const [dir, viewport, hasTouch, isMobile] of [["mobile", { width: 393, height: 850 }, true, true], ["desktop", { width: 1280, height: 800 }, false, false]]) {
    const page = await browser.newPage({ viewport, hasTouch, isMobile });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    await capture(page, dir, "01-boot-nav");

    // Context sheet from the machine chip.
    const sheetOpened = await page.evaluate(deepTap("Change machine, project or workspace"));
    await page.waitForTimeout(1400);
    if (sheetOpened) {
      await capture(page, dir, "02-context-sheet-machines");
      await page.evaluate(deepTap("Close context sheet"));
      await page.waitForTimeout(800);
    } else {
      console.log(`WARN ${dir}: context sheet trigger not found`);
    }

    // Drill into the first project.
    const drill1 = await page.evaluate(`(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&kids[i].tagName==="PROJECT-LIST")found=kids[i];}};visit(document);if(!found)return false;var el=found.shadowRoot.querySelector("button.action-main");if(!el)return false;el.click();return true;})()`);
    await page.waitForTimeout(2000);
    if (!drill1) { console.log(`WARN ${dir}: no project tile to drill`); await page.close(); continue; }
    await capture(page, dir, "03-project-sessions");

    // Panel tiles row: Files, Terminal, Tasks, Relays, Updates, Info.
    for (const tile of ["Files", "Terminal", "Tasks", "Relays", "Updates", "Info"]) {
      const opened = await page.evaluate(deepTap(tile));
      await page.waitForTimeout(1600);
      if (opened) {
        await capture(page, dir, `04-panel-${tile.toLowerCase()}`);
        await page.evaluate(deepTap("Back"));
        await page.waitForTimeout(900);
      } else {
        console.log(`WARN ${dir}: panel tile ${tile} not found`);
      }
    }

    // Open the first session → chat.
    const openedSession = await page.evaluate(`(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&kids[i].tagName==="SESSION-LIST")found=kids[i];}};visit(document);if(!found)return false;var el=found.shadowRoot.querySelector(".action-row .action-main");if(!el)return false;el.click();return true;})()`);
    await page.waitForTimeout(2600);
    if (!openedSession) { console.log(`WARN ${dir}: no session row to open`); await page.close(); continue; }
    await capture(page, dir, "05-chat");

    // Drawer: collapsed chip, then expanded.
    const drawerToggle = await page.evaluate(`${deepAll(".drawer-toggle")}.length`);
    if (drawerToggle > 0) {
      await page.evaluate(`(${deepAll(".drawer-toggle")})[0].click()`);
      await page.waitForTimeout(1200);
      await capture(page, dir, "06-drawer-expanded");
      await page.evaluate(`(${deepAll(".drawer-toggle")})[0].click()`);
      await page.waitForTimeout(800);
    } else {
      console.log(`WARN ${dir}: no drawer toggle (no contributing sections?)`);
    }

    // Settings dialog.
    const settingsOpened = await page.evaluate(deepTap("Open settings"));
    await page.waitForTimeout(1400);
    if (settingsOpened) {
      await capture(page, dir, "07-settings");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
    } else {
      console.log(`WARN ${dir}: settings trigger not found`);
    }

    // Quick switcher via the session title button in the context bar.
    const quickOpened = await page.evaluate(deepTap("Open session selection"));
    await page.waitForTimeout(1400);
    if (quickOpened) {
      await capture(page, dir, "08-quick-switcher");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
    } else {
      console.log(`WARN ${dir}: quick switcher trigger not found`);
    }

    await page.close();
  }
} finally {
  await browser.close();
}

writeFileSync(`${OUT}/metrics.json`, JSON.stringify(run, null, 1));
const summary = run.map((r) => ({ name: r.name, elements: r.elements, under44: r.under44.length, worst: r.under44[0] ?? null, inputsUnder44: r.inputsUnder44.length, worstInput: r.inputsUnder44[0] ?? null }));
console.log("\n=== tap-target summary (sorted by area ascending; interactive + inputs) ===");
for (const row of summary) console.log(`${row.name}: ${row.elements} elements, ${row.under44} interactive under 44px (worst ${row.worst ? `${row.worst.h}x${row.worst.w} "${row.worst.label}"` : "none"}), ${row.inputsUnder44} inputs under 44px${row.worstInput ? ` (worst ${row.worstInput.h}x${row.worstInput.w} "${row.worstInput.label}")` : ""}`);
console.log(`\nfull JSON: ${OUT}/metrics.json`);
