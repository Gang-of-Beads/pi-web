import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.TOUCH_BASE ?? "http://127.0.0.1:8505";
const OUT = "/tmp/uiux-audit";
mkdirSync(OUT, { recursive: true });

const AA_FLOOR = 24;
const COMFORT = 44;
const HIT_SLOP_CLASSES = ["msg-action"];
/** An input inside a <label> big enough to carry the tap area defers to the
 *  label row (the label toggles the input); an inline link meeting AA is
 *  inline-exception territory. */
const LABEL_TARGET_TAGS = new Set(["INPUT"]);
const COMFORT_EXEMPT = [
  { cls: "action-menu-toggle", require: "tiles" },
  { cls: "msg-meta", require: null },
  { cls: "session-checkbox", require: null },
];

/** Drills: each step opens one surface or popover state. Failure of any
 *  precondition is loud. */
const DRILLS = [
  { name: "boot", fresh: true, open: null },
  { name: "sessions", fresh: true, opens: ["project"] },
  { name: "chat", fresh: true, opens: ["project", "session"] },
  { name: "chat-drawer", opens: ["drawer"] },
  { name: "msg-row-menu", fresh: true, opens: ["project", "session", "msgMenu"] },
  { name: "model-picker", fresh: true, opens: ["project", "session", "modelPicker"] },
  { name: "thinking-picker", opens: ["thinkingPicker"] },
  { name: "settings", fresh: true, opens: ["settings"] },
  { name: "settings-appearance", opens: ["settingsAppearance"] },
  { name: "quick-switcher", fresh: true, opens: ["quickSwitcher"] },
  { name: "qs-row-menu", opens: ["qsRowMenu"] },
  { name: "context-sheet", fresh: true, opens: ["contextSheet"] },
  { name: "add-project-dialog", fresh: true, opens: ["addProject"] },
];

const OPENERS = {
  project: `(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&kids[i].tagName==='PROJECT-LIST')found=kids[i];}};visit(document);if(!found)throw 'no project-list';var el=found.shadowRoot.querySelector('button.action-main');if(!el)throw 'no tile';el.click();return true;})()`,
  session: `(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&kids[i].tagName==='SESSION-LIST')found=kids[i];}};visit(document);if(!found)throw 'no session-list';var el=found.shadowRoot.querySelector('.action-row .action-main');if(!el)throw 'no row';el.click();return true;})()`,
  drawer: `(function(){var hit=null;var walk=function(root){var els=root.querySelectorAll('button');for(var j=0;j<els.length;j++){var t=els[j].getAttribute('aria-label')||'';if(hit===null&&t.indexOf('session')!==-1&&t.toLowerCase().indexOf('sections')!==-1)hit=els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);if(!hit)throw 'no drawer trigger';hit.click();return true;})()`,
  msgMenu: `(function(){var hit=null;var walk=function(root){var els=root.querySelectorAll('button.msg-action');for(var j=0;j<els.length;j++){if(!hit)hit=els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);if(!hit)throw 'no msg-action';hit.click();return true;})()`,
  modelPicker: `(function(){var hit=null;var walk=function(root){var els=root.querySelectorAll('button.select-model');for(var j=0;j<els.length;j++){if(!hit)hit=els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);if(!hit)throw 'no select-model';hit.click();return true;})()`,
  thinkingPicker: `(function(){var hit=null;var walk=function(root){var els=root.querySelectorAll('button.select-thinking');for(var j=0;j<els.length;j++){if(!hit)hit=els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);if(!hit)throw 'no select-thinking';hit.click();return true;})()`,
  settings: `(async function(){(function(){var f=null;var walkF=function(root){var els=root.querySelectorAll('button.compact-fold');for(var j=0;j<els.length;j++){if(f===null)f=els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walkF(kids[i].shadowRoot);}};walkF(document);if(f){f.click();return true;}return false;})();var deadline=Date.now()+2000;while(Date.now()<deadline){try{(function(){var hit=null;var walk=function(root){var els=root.querySelectorAll('button.compact-actions-row button, button');for(var j=0;j<els.length;j++){var t=els[j].getAttribute('aria-label')||'';if(hit===null&&t.indexOf('Open settings')!==-1)hit=els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);if(!hit)throw 'no settings trigger';hit.click();return true;})();return true;}catch(e){}await new Promise(function(r){setTimeout(r,120);});}throw new Error('trigger not found after unfold');})()`,
  settingsAppearance: `(async function(){(function(){var f=null;var walkF=function(root){var els=root.querySelectorAll('button.compact-fold');for(var j=0;j<els.length;j++){if(f===null)f=els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walkF(kids[i].shadowRoot);}};walkF(document);if(f){f.click();return true;}return false;})();var deadline=Date.now()+2000;while(Date.now()<deadline){try{(function(){var hit=null;var walk=function(root){var els=root.querySelectorAll('button, [role=tab]');for(var j=0;j<els.length;j++){var t=(els[j].textContent||'')+(els[j].getAttribute('aria-label')||'');if(hit===null&&t.indexOf('Appearance')!==-1)hit=els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);if(!hit)throw 'no appearance entry';hit.click();return true;})();return true;}catch(e){}await new Promise(function(r){setTimeout(r,120);});}throw new Error('trigger not found after unfold');})()`,
  quickSwitcher: `(async function(){(function(){var f=null;var walkF=function(root){var els=root.querySelectorAll('button.compact-fold');for(var j=0;j<els.length;j++){if(f===null)f=els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walkF(kids[i].shadowRoot);}};walkF(document);if(f){f.click();return true;}return false;})();var deadline=Date.now()+2000;while(Date.now()<deadline){try{(function(){var hit=null;var walk=function(root){var els=root.querySelectorAll('button');for(var j=0;j<els.length;j++){var t=(els[j].getAttribute('aria-label')||els[j].textContent||'');if(hit===null&&t.indexOf('Open session selection')!==-1)hit=els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);if(!hit)throw 'no quick switcher trigger';hit.click();return true;})();return true;}catch(e){}await new Promise(function(r){setTimeout(r,120);});}throw new Error('trigger not found after unfold');})()`,
  qsRowMenu: `(async function(){(function(){var f=null;var walkF=function(root){var els=root.querySelectorAll('button.compact-fold');for(var j=0;j<els.length;j++){if(f===null)f=els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walkF(kids[i].shadowRoot);}};walkF(document);if(f){f.click();return true;}return false;})();var deadline=Date.now()+2000;while(Date.now()<deadline){try{(function(){var hit=null;var walk=function(root){var els=root.querySelectorAll('button.row-menu-toggle');for(var j=0;j<els.length;j++){if(!hit)hit=els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);if(!hit)throw 'no row-menu-toggle';hit.click();return true;})();return true;}catch(e){}await new Promise(function(r){setTimeout(r,120);});}throw new Error('trigger not found after unfold');})()`,
  contextSheet: `(async function(){var walk=function(root){var els=root.querySelectorAll('button');for(var j=0;j<els.length;j++){var t=(els[j].getAttribute('aria-label')||els[j].textContent||'');if(t.indexOf('context')!==-1||t.indexOf('Change ')!==-1||t.indexOf('Choose ')!==-1)return els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot){var hit=walk(kids[i].shadowRoot);if(hit)return hit;}}return null;};for(var k=0;k<20;k++){var hit=walk(document);if(hit){hit.click();return true;}await new Promise(function(r){setTimeout(r,250);});}throw 'no context trigger';})()`,
  addProject: `(function(){var hit=null;var walk=function(root){var els=root.querySelectorAll('button');for(var j=0;j<els.length;j++){var t=(els[j].getAttribute('aria-label')||els[j].textContent||'');if(hit===null&&t.indexOf('Add project')!==-1)hit=els[j];}var kids=root.querySelectorAll('*');for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);if(!hit)throw 'no add project';hit.click();return true;})()`,
};

const METRICS = `(function(){
  var rows=[];var borders=0;var colors={};
  var walk=function(root){var els=root.querySelectorAll("button, a, input, [role=button], [role=tab], [role=menuitem]");
    for(var j=0;j<els.length;j++){var el=els[j];var r=el.getBoundingClientRect();
      if(r.width===0&&r.height===0)continue;
      var cs=getComputedStyle(el);
      var cls=String(el.className&&el.className.baseVal!==undefined?el.className.baseVal:el.className||"");
      var lw=0,lh=0,lb=el.closest("label");
      if(lb){var lr=lb.getBoundingClientRect();lw=Math.round(lr.width);lh=Math.round(lr.height);}
      rows.push({cls:cls.slice(0,60),tag:el.tagName,label:(el.getAttribute("aria-label")||el.textContent||"").trim().slice(0,40),w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.left),y:Math.round(r.top),opacity:cs.opacity,visibility:cs.visibility,disabled:el.disabled===true,inTiles:!!el.closest(".list-body.tiles"),labelW:lw,labelH:lh});
      var b=cs.borderStyle;
      if(b!=="none"&&parseFloat(cs.borderTopWidth)>0)borders++;
      if(el.tagName==="INPUT"&&el.type==="checkbox"){/*native*/}
    }
    var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};
  walk(document);
  return {rows:rows,borders:borders};
})()`;

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
/**
 * What the stack is serving has to be what was built, or a pass means nothing.
 * One audit run reported three failures and the next reported none; the
 * difference was a page that had loaded a half-written bundle while the stack
 * rebuilt. That must fail loudly and by name, not read as flakiness.
 */
function builtEntryAsset() {
  const built = readFileSync("dist/client/index.html", "utf8");
  const match = built.match(/assets\/index-[A-Za-z0-9_-]+\.js/u);
  if (match === null) throw new Error("no entry asset in dist/client/index.html");
  return match[0];
}

const pageErrors = [];
page.on("pageerror", (error) => { pageErrors.push(String(error).slice(0, 160)); });

const servedEntry = await page.evaluate(() => {
  const script = [...document.querySelectorAll("script[src]")].map((tag) => tag.getAttribute("src") ?? "").find((src) => src.includes("assets/index-"));
  return script ?? "";
});
const expectedEntry = builtEntryAsset();
if (!servedEntry.includes(expectedEntry)) {
  console.error(`FAIL: the stack is serving ${servedEntry || "no entry bundle"}, the build on disk is ${expectedEntry}. Rebuild and restart before auditing.`);
  await browser.close();
  process.exit(1);
}

const bootControls = await page.evaluate(`(function(){var n=0;var walk=function(root){n+=root.querySelectorAll("button, a[href], input, select, textarea, [role=button]").length;var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};walk(document);return n;})()`);
if (bootControls < 10) {
  console.error(`FAIL: boot rendered ${String(bootControls)} controls; the page did not finish loading, so an empty pass would be a lie.`);
  await browser.close();
  process.exit(1);
}

const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
if (!coarse) { console.error("FAIL: emulation is not (pointer: coarse)"); process.exit(1); }

const inventory = {};
const failures = [];

for (const drill of DRILLS) {
  if (drill.fresh) {
    await openBase(page, BASE);
    await page.waitForTimeout(2500);
  }
  for (const key of drill.opens ?? []) {
    try {
      await page.evaluate(OPENERS[key]);
      await page.waitForTimeout(1400);
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/, "").slice(0, 120);
      failures.push(`${drill.name}: precondition missing (${key}) - ${message}`);
      await page.screenshot({ path: `${OUT}/${drill.name}-OPENFAIL.png` });
      break;
    }
  }
  await page.screenshot({ path: `${OUT}/${drill.name}.png` });
  const m = await page.evaluate(METRICS);
  inventory[drill.name] = { rows: m.rows, borders: m.borders, controlCount: m.rows.length };
  for (const r of m.rows) {
    const where = `${drill.name}: ${r.cls || r.tag} "${r.label}"`;
    if (r.opacity === "0" || r.visibility === "hidden") continue;
    if (r.w < 4 || r.h < 4) continue;
    if (r.disabled) continue;
    const labelCarriesTap = LABEL_TARGET_TAGS.has(r.tag) && r.labelW >= COMFORT && r.labelH >= AA_FLOOR;
    if (labelCarriesTap) continue;
    if (r.w < AA_FLOOR || r.h < AA_FLOOR) {
      if (!HIT_SLOP_CLASSES.some((hit) => r.cls.includes(hit))) failures.push(`${where} ${r.w}x${r.h} below AA ${AA_FLOOR}`);
      continue;
    }
    const isAaMetCheckbox = r.tag === "INPUT" && r.w >= AA_FLOOR && r.h >= AA_FLOOR;
    const inlineExempt = r.tag === "A" && r.h >= AA_FLOOR;
    const exempt = COMFORT_EXEMPT.find((e) => r.cls.includes(e.cls) && (!e.require || r.inTiles))
      || (HIT_SLOP_CLASSES.some((hit) => r.cls.includes(hit)) ? {} : undefined)
      || (isAaMetCheckbox ? {} : undefined)
      || (labelCarriesTap ? {} : undefined)
      || (inlineExempt ? {} : undefined);
    if (!exempt && (r.w < COMFORT || r.h < COMFORT)) failures.push(`${where} ${r.w}x${r.h} below coarse ${COMFORT}`);
  }
}

writeFileSync(`${OUT}/inventory.json`, JSON.stringify(inventory, null, 1));
await browser.close();

const summary = Object.entries(inventory).map(([name, s]) => `${name}: ${s.controlCount} controls, ${s.borders} bordered elements`).join("\n");
if (failures.length > 0) {
  console.error(`AUDIT FAILED (${failures.length}):\n${failures.slice(0, 30).join("\n")}\n---\n${summary}`);
  process.exit(1);
}
if (pageErrors.length > 0) {
  console.error(`FAIL: the page raised ${String(pageErrors.length)} script error(s): ${pageErrors.slice(0, 3).join(" | ")}`);
  await browser.close();
  process.exit(1);
}
console.log(`AUDIT PASSED (floors + visibility, current build, no page errors)\n${summary}`);
