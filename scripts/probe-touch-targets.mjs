import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.TOUCH_BASE ?? "http://127.0.0.1:8505";

const AA_FLOOR = 24;
const COMFORT = 44;
/** Recorded exemptions from the coarse 44px comfort floor. The hit-slop
 *  actions extend to 44px through an ::after overlay (invisible to
 *  getBoundingClientRect); the tile menu carries a documented 36px exemption
 *  (shared.ts) because the tile's own cell carries the row's tap area; the
 *  collapsed msg-meta chip is inline in the message header line (WCAG 2.5.8
 *  inline exception) and meets the AA floor. */
const HIT_SLOP_CLASSES = ["msg-action"];
const EXEMPT_36 = ["action-menu-toggle"];
const EXEMPT_INLINE = ["msg-meta"];

const deepAll = (selector) => `(function(){
  var out=[];
  var walk=function(root){var found=root.querySelectorAll(${JSON.stringify(selector)});for(var j=0;j<found.length;j++)out.push(found[j]);var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};
  walk(document);
  return out;
})()`;
const metrics = `(function(){
  var rows=[];
  var walk=function(root){var els=root.querySelectorAll("button, a, [role=button], [role=tab]");
    for(var j=0;j<els.length;j++){var el=els[j];var r=el.getBoundingClientRect();
      if(r.width===0&&r.height===0)continue;
      rows.push({cls:String(el.className||""),label:(el.getAttribute("aria-label")||el.textContent||"").trim().slice(0,40),w:Math.round(r.width),h:Math.round(r.height)});}
    var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};
  walk(document);
  return rows;
})()`;

const failures = [];
const audit = (surface, rows) => {
  for (const r of rows) {
    const cls = r.cls;
    if (HIT_SLOP_CLASSES.some((hit) => cls.includes(hit))) continue;
    if (r.w < 4 || r.h < 4) continue;
    if (r.w < AA_FLOOR || r.h < AA_FLOOR) failures.push(`${surface}: ${r.w}x${r.h} "${r.label}" below AA ${AA_FLOOR} (${cls.slice(0, 40)})`);
    const exempt36 = EXEMPT_36.some((name) => cls.includes(name));
    const exemptInline = EXEMPT_INLINE.some((name) => cls.includes(name));
    if (!exempt36 && !exemptInline && (r.w < COMFORT || r.h < COMFORT)) {
      if (!failures.some((line) => line.startsWith(`${surface}:`) && line.includes(`"${r.label}"`))) {
        failures.push(`${surface}: ${r.w}x${r.h} "${r.label}" below coarse ${COMFORT} (${cls.slice(0, 40)})`);
      }
    }
  }
};

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

audit("boot", await page.evaluate(metrics));

const drill = await page.evaluate(`(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&kids[i].tagName==="PROJECT-LIST")found=kids[i];}};visit(document);if(!found)return false;var el=found.shadowRoot.querySelector("button.action-main");if(!el)return false;el.click();return true;})()`);
if (!drill) { console.error("FAIL: precondition missing - no project tile to drill into"); process.exit(1); }
await page.waitForTimeout(2000);
audit("sessions", await page.evaluate(metrics));

const session = await page.evaluate(`(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&kids[i].tagName==="SESSION-LIST")found=kids[i];}};visit(document);if(!found)return false;var el=found.shadowRoot.querySelector(".action-row .action-main");if(!el)return false;el.click();return true;})()`);
if (!session) { console.error("FAIL: precondition missing - no session row to open"); process.exit(1); }
await page.waitForTimeout(2600);
audit("chat", await page.evaluate(metrics));

await page.evaluate(`(function(){var hit=null;var walk=function(root){var els=root.querySelectorAll("button");for(var j=0;j<els.length;j++){var t=(els[j].getAttribute("aria-label")||"");if(hit===null&&t.indexOf("Open settings")!==-1){hit=els[j];}}var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);hit?.click();return true;})()`);
await page.waitForTimeout(1400);
audit("settings", await page.evaluate(metrics));

const quick = await page.evaluate(`(function(){var hit=null;var walk=function(root){var els=root.querySelectorAll("button");for(var j=0;j<els.length;j++){var t=(els[j].getAttribute("aria-label")||els[j].textContent||"");if(hit===null&&t.indexOf("Open session selection")!==-1){hit=els[j];}}var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);if(!hit)return false;hit.click();return true;})()`);
if (!quick) { console.error("FAIL: precondition missing - quick switcher trigger not found"); process.exit(1); }
await page.waitForTimeout(1600);
audit("quick-switcher", await page.evaluate(metrics));

await browser.close();

if (failures.length > 0) {
  console.error(`TOUCH-TARGET AUDIT FAILED (${failures.length} below floor):`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`touch-target audit passed: AA ${AA_FLOOR}px everywhere, coarse ${COMFORT}px with recorded exemptions only`);
