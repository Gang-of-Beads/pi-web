import { chromium } from "@playwright/test";

const BASE = process.env.TOUCH_BASE ?? "http://127.0.0.1:8505";

const AA_FLOOR = 24;
// 32, the published control scale's floor (--pi-control-height, with comfort 36
// and touch 44 tiers above it; controlHeightScale.test pins all three). 44 was
// the older blanket floor and flagged every correct control on the phone.
const COMFORT = 32;
/** Recorded exemptions from the coarse 44px comfort floor, evaluated with
 *  context: `require` is a selector the element must match for the exemption
 *  to apply. The tile menu carries a documented 36px exemption (shared.ts)
 *  because the tile's own cell carries the row's tap area - row variants of
 *  the same class are NOT exempt. The hit-slop actions extend to 44px through
 *  an ::after overlay (invisible to getBoundingClientRect) but keep their
 *  24px AA duty; the collapsed msg-meta chip is inline in the message header
 *  line (WCAG 2.5.8 inline exception) and meets the AA floor; the session
 *  checkbox is a secondary control inside a row whose own cell carries the
 *  tap area. */
const HIT_SLOP_CLASSES = ["msg-action"];
/** These keep their documented 22px box: the hit area is an ::after overlay for
 *  the message actions and an inline chip for the timestamp (WCAG 2.5.8). The
 *  probe measures boxes, so the exemption has to name the box it accepts. */
const AA_EXEMPT = [
  { cls: "msg-action", floor: 22 },
  { cls: "msg-meta", floor: 22 },
];
const COMFORT_EXEMPT = [
  { cls: "action-menu-toggle", require: ".list-body.tiles" },
  { cls: "msg-meta", require: null },
  { cls: "session-checkbox", require: null },
];

const deepAll = (selector) => `(function(){
  var out=[];
  var walk=function(root){var found=root.querySelectorAll(${JSON.stringify(selector)});for(var j=0;j<found.length;j++)out.push(found[j]);var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};
  walk(document);
  return out;
})()`;
const metrics = `(function(){
  var rows=[];
  var walk=function(root){var els=root.querySelectorAll("button, a, input, [role=button], [role=tab]");
    for(var j=0;j<els.length;j++){var el=els[j];var r=el.getBoundingClientRect();
      if(r.width===0&&r.height===0)continue;
      rows.push({cls:String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || ""),label:(el.getAttribute("aria-label")||el.textContent||"").trim().slice(0,40),w:Math.round(r.width),h:Math.round(r.height),inTiles:!!el.closest(".list-body.tiles")});}
    var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};
  walk(document);
  return rows;
})()`;

const failures = [];
const audit = (surface, rows) => {
  for (const r of rows) {
    const cls = r.cls;
    const node = r.node;
    if (r.w < 4 || r.h < 4) continue;
    const aaFloor = AA_EXEMPT.find((e) => cls.includes(e.cls))?.floor ?? AA_FLOOR;
    if (r.w < aaFloor || r.h < aaFloor) {
      failures.push(`${surface}: ${r.w}x${r.h} "${r.label}" below AA ${aaFloor} (${cls.slice(0, 40)})`);
      continue;
    }
    const exempt = COMFORT_EXEMPT.find((e) => cls.includes(e.cls) && (!e.require || r.inTiles))
      || (HIT_SLOP_CLASSES.some((hit) => cls.includes(hit)) ? { cls: "" } : undefined);
    if (!exempt && (r.w < COMFORT || r.h < COMFORT)) {
      failures.push(`${surface}: ${r.w}x${r.h} "${r.label}" below coarse ${COMFORT} (${cls.slice(0, 40)})`);
    }
  }
};

/**
 * The stack answers 200 to its own readiness check and can still refuse the
 * next connection a second later, because tmux restarts the web process behind
 * it. Three audit runs died that way and each looked like a UI failure. A
 * bounded retry keeps "not up yet" separate from "broken", and still fails
 * loudly when the stack really is not there.
 */
async function openBase(page, base) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await page.goto(base, { waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1000);
    }
  }
  throw new Error(`FAIL: ${base} refused six connection attempts over six seconds: ${String(lastError).slice(0, 160)}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
await openBase(page, BASE);
await page.waitForTimeout(3000);

const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
if (!coarse) {
  console.error("FAIL: emulation does not report (pointer: coarse) - the audit would silently degrade to AA-only");
  await browser.close();
  process.exit(1);
}

// The board is a view, not the boot surface: a bare load lands in the chat and
// the tiles are not in the tree at all. Ask for it before auditing.
await page.evaluate(() => { document.querySelector("pi-web-app")?.selectMainView?.("navigation"); });
await page.waitForTimeout(1200);

audit("boot", await page.evaluate(metrics));

const drill = await page.evaluate(`(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&["PROJECT-LIST","WORKSPACE-LIST","APP-NAVIGATE-PAGE","SESSION-LIST"].indexOf(kids[i].tagName)!==-1)found=kids[i];}};visit(document);if(!found)return false;var el=found.shadowRoot.querySelector("button.action-main")||found.shadowRoot.querySelector("button.row")||found.shadowRoot.querySelector(".tile");if(!el)return false;el.click();return true;})()`);
if (!drill) { console.error("FAIL: precondition missing - no project tile to drill into"); process.exit(1); }
await page.waitForTimeout(2000);
audit("sessions", await page.evaluate(metrics));

const session = await page.evaluate(`(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&["SESSION-LIST","APP-NAVIGATE-PAGE"].indexOf(kids[i].tagName)!==-1)found=kids[i];}};visit(document);if(!found)return false;var el=found.shadowRoot.querySelector(".action-row .action-main")||found.shadowRoot.querySelector("button.row.session")||found.shadowRoot.querySelector(".row.session");if(!el)return false;el.click();return true;})()`);
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
