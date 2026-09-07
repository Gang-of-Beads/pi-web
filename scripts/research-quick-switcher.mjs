import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const OUT = "/tmp/layout-research";
mkdirSync(`${OUT}/mobile`, { recursive: true });

const metrics = `(function(){
  var rows=[];
  var walk=function(root){var els=root.querySelectorAll("button, a, [role=button], [role=tab], input, textarea, select");
    for(var j=0;j<els.length;j++){var el=els[j];var r=el.getBoundingClientRect();
      if(r.width===0&&r.height===0)continue;
      rows.push({tag:el.tagName.toLowerCase(),label:(el.getAttribute("aria-label")||el.textContent||el.getAttribute("placeholder")||"").trim().slice(0,40),cls:el.className,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)});}
    var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};
  walk(document);
  return rows;
})()`;

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
await page.goto("http://127.0.0.1:8505", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
const opened = await page.evaluate(`(function(){var hit=null;var walk=function(root){var els=root.querySelectorAll("button, [role=button], li, a");for(var j=0;j<els.length;j++){var t=(els[j].getAttribute("aria-label")||els[j].textContent||"").trim();if(hit===null&&t.indexOf("Open session selection")!==-1){hit=els[j];}}var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);if(!hit)return false;hit.click();return true;})()`);
await page.waitForTimeout(1600);
if (!opened) { console.log("FAIL: quick switcher trigger not found"); process.exit(1); }
await page.screenshot({ path: `${OUT}/mobile/08-quick-switcher.png` });
const rows = await page.evaluate(metrics);
writeFileSync(`${OUT}/quick-switcher-metrics.json`, JSON.stringify(rows, null, 1));
const interactive = rows.filter((r) => r.tag === "button" || r.tag === "a");
const small = interactive.filter((r) => r.h < 44 || r.w < 44).sort((a, b) => a.w * a.h - b.w * b.h);
console.log(`quick-switcher: ${rows.length} elements, ${small.length} interactive under 44px`);
const seen = new Set();
for (const r of small) { const k = `${r.cls}|${r.w}x${r.h}`; if (seen.has(k)) continue; seen.add(k); console.log(`  ${r.w}x${r.h} "${r.label}" cls=${String(r.cls).slice(0, 40)}`); }
await browser.close();
