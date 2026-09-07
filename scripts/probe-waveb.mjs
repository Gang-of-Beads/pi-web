import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: "dark" })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 160)));
page.on("dialog", (d) => { void d.accept(); });

const results = [];
const record = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? "PASS" : "FAIL", name, ok ? "" : JSON.stringify(detail ?? {}).slice(0, 300)); };

const VISIT = `(function(){
  var out={};var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);} };
  visit(document);return out;
})()`;
const findInShadow = (selector) => `(function(){
  var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var hit=root.querySelector(${JSON.stringify(selector)});if(hit&&hit.shadowRoot&&!found)found=hit;};
  visit(document);return found;
})()`;
const tapText = (prefix) => `(function(){var rows=[];var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var btns=root.querySelectorAll("button");for(var j=0;j<btns.length;j++){var t=btns[j].textContent.trim();if(t.indexOf(${JSON.stringify(prefix)})===0)rows.push(btns[j]);}};visit(document);if(rows.length===0)return false;rows[0].click();return true;})()`;
const tap = async (prefix) => { const ok = await page.evaluate(tapText(prefix)).catch(() => false); if (ok) await page.waitForTimeout(1200); return ok; };
const tapExact = async (text) => {
  const ok = await page.evaluate(`(function(){var rows=[];var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var btns=root.querySelectorAll("button");for(var j=0;j<btns.length;j++){if(btns[j].textContent.trim()===${JSON.stringify(text)})rows.push(btns[j]);}};visit(document);if(rows.length===0)return false;rows[0].click();return true;})()`).catch(() => false);
  if (ok) await page.waitForTimeout(1200);
  return ok;
};
const appState = () => page.evaluate(`(function(){var app=document.querySelector("pi-web-app");return {machines:(app.state.machines||[]).map(function(m){return {id:m.id,name:m.name,kind:m.kind};}),selectedMachine:app.state.selectedMachine?app.state.selectedMachine.id:null,selectedName:app.state.selectedMachine?app.state.selectedMachine.name:null,projects:(app.state.projects||[]).length,machinesLoad:app.state.machinesLoad};})()`);

const openSheet = async () => {
  await page.evaluate(`(function(){var hit=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var btns=root.querySelectorAll("button");for(var j=0;j<btns.length;j++){if((btns[j].getAttribute("aria-label")||"")==="Change machine, project or workspace")hit=btns[j];}};visit(document);if(hit)hit.click();})()`);
  await page.waitForTimeout(1200);
};
const closeSheet = async () => {
  await page.evaluate(`(function(){var hit=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var btns=root.querySelectorAll("button");for(var j=0;j<btns.length;j++){if(btns[j].getAttribute("aria-label")==="Close context sheet")hit=btns[j];}};visit(document);if(hit)hit.click();})()`);
  await page.waitForTimeout(800);
};
const sheetMachineRows = () => page.evaluate(`(function(){
  var found={sheet:false,machineList:false,rows:0,names:[]};
  var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var cs=root.querySelector("context-switcher-sheet");if(cs&&cs.shadowRoot&&!found.sheet){var ml=cs.shadowRoot.querySelector("machine-list");if(ml&&ml.shadowRoot){found.sheet=true;found.machineList=true;ml.shadowRoot.querySelectorAll("button.action-main").forEach(function(b){found.rows+=1;found.names.push(b.textContent.trim().slice(0,40));});}}};
  visit(document);return found;
})()`);
const selectMachineInSheet = async (name) => {
  const ok = await page.evaluate(`(function(){
    var hit=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var cs=root.querySelector("context-switcher-sheet");if(cs&&cs.shadowRoot){var ml=cs.shadowRoot.querySelector("machine-list");if(ml&&ml.shadowRoot){var btns=ml.shadowRoot.querySelectorAll("button.action-main");for(var i=0;i<btns.length;i++){if(btns[i].textContent.indexOf(${JSON.stringify(name)})!==-1)hit=btns[i];}}}};
    visit(document);if(!hit)return false;hit.click();return true;
  })()`).catch(() => false);
  await page.waitForTimeout(2500);
  return ok;
};

console.log("== boot: the machines roster loads through the plugin's routes");
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("pi-web-app", { timeout: 15000 });
await page.waitForTimeout(3500);
const boot = await appState();
record("boot: roster has local plus prod-8504", boot.machinesLoad === "loaded" && boot.machines.length >= 2 && boot.machines.some((m) => m.kind === "local") && boot.machines.some((m) => m.name === "prod-8504"), boot);

console.log("== the context sheet renders the plugin's machines section");
await openSheet();
const sheet = await sheetMachineRows();
record("sheet machine group renders machine-list rows", sheet.sheet && sheet.machineList && sheet.rows >= 2, sheet);
await page.screenshot({ path: "/tmp/waveb-sheet-machines.png" });

console.log("== switching to prod-8504 rides the proxy");
const prodId = boot.machines.find((m) => m.name === "prod-8504")?.id;
const switched = prodId !== undefined ? await selectMachineInSheet("prod-8504") : false;
await closeSheet();
const afterSwitch = await appState();
record("sheet pick selects the remote machine", switched && afterSwitch.selectedMachine === prodId, afterSwitch);
record("proxy projects load for the remote machine", afterSwitch.projects > 0, afterSwitch);

console.log("== the palette carries the plugin's machine actions (remote selected)");
await tapExact("Actions");
await page.waitForTimeout(2200);
const paletteTexts = await page.evaluate(`(function(){var out=[];var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}root.querySelectorAll("button").forEach(function(b){out.push(b.textContent.trim());});};visit(document);return out;})()`);
const hasAction = (t) => paletteTexts.some((x) => x.startsWith(t));
record("palette lists the plugin's four machine actions", hasAction("Add machine") && hasAction("Refresh selected machine") && hasAction("Open selected machine PI WEB") && hasAction("Remove selected machine"), paletteTexts.filter((t) => t.toLowerCase().includes("machine")).slice(0, 6));
await page.keyboard.press("Escape");
await page.waitForTimeout(800);

console.log("== add a self-referential remote machine through the dialog seam");
await tapExact("Actions");
await page.waitForTimeout(2200);
await tap("Add machine");
await page.waitForTimeout(1200);
const dialogOpen = await page.evaluate(`(function(){var hit=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var md=root.querySelector("machine-dialog");if(md&&md.shadowRoot&&md.shadowRoot.querySelector("form"))hit=md;};visit(document);return hit!==null;})()`);
record("plugin machine dialog opens inside the shell seam", dialogOpen, {});
const setUrl = await page.evaluate(`(function(){
  var inp=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var md=root.querySelector("machine-dialog");if(md&&md.shadowRoot){var f=md.shadowRoot.querySelector("input[name='baseUrl']");if(f)inp=f;}};
  visit(document);if(!inp)return false;
  var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
  setter.call(inp,"${BASE}");
  inp.dispatchEvent(new Event("input",{bubbles:true,composed:true}));
  return true;
})()`);
await page.waitForTimeout(600);
if (setUrl) {
  await page.evaluate(`(function(){
    var inp=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var md=root.querySelector("machine-dialog");if(md&&md.shadowRoot){var f=md.shadowRoot.querySelector("input[name='name']");if(f)inp=f;}};
    visit(document);if(!inp)return false;
    var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
    setter.call(inp,"waveb-self");
    inp.dispatchEvent(new Event("input",{bubbles:true,composed:true}));
    return true;
  })()`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/waveb-machine-dialog.png" });
  await page.evaluate(`(function(){var hit=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var md=root.querySelector("machine-dialog");if(md&&md.shadowRoot){var b=md.shadowRoot.querySelector("button.primary");if(b&&!b.disabled)hit=b;}};visit(document);if(hit)hit.click();})()`);
  await page.waitForTimeout(3500);
}
const afterAdd = await appState();
const selfMachine = afterAdd.machines.find((m) => m.name === "waveb-self");
record("createMachine adds waveb-self to the roster", selfMachine !== undefined && afterAdd.machines.length === boot.machines.length + 1, afterAdd);

console.log("== the self-referential remote round-trips through the proxy");
if (selfMachine !== undefined) {
  await openSheet();
  await selectMachineInSheet("waveb-self");
  await closeSheet();
  const afterSelf = await appState();
  record("self-referential remote serves projects through the proxy", afterSelf.selectedMachine === selfMachine.id && afterSelf.projects > 0, afterSelf);
  await page.screenshot({ path: "/tmp/waveb-self-remote.png" });

  console.log("== remove waveb-self through the plugin action");
  await tapExact("Actions");
  await page.waitForTimeout(2200);
  await tap("Remove selected machine");
  await page.waitForTimeout(3000);
  const afterRemove = await appState();
  record("removeMachine drops waveb-self and falls back", !afterRemove.machines.some((m) => m.name === "waveb-self") && afterRemove.machines.length === boot.machines.length, afterRemove);
} else {
  record("self-referential remote serves projects through the proxy", false, { skipped: "waveb-self was not created" });
  record("removeMachine drops waveb-self and falls back", false, { skipped: "waveb-self was not created" });
}

console.log("== a failed roster leaves the deep link intact");
const failRouteActive = await page.evaluate(`(function(){
  return typeof window.__wavebFail === "undefined";
})()`);
await page.route("**/api/machines*", (route) => { void route.abort(); });
const deepLink = `${BASE}/?machine=${prodId}`;
await page.goto(deepLink, { waitUntil: "domcontentloaded" });
await page.waitForSelector("pi-web-app", { timeout: 15000 });
await page.waitForTimeout(1200);
const urlDuringFailure = page.url();
record("failed roster defers instead of flattening the deep link", urlDuringFailure.includes(`machine=${prodId}`), { url: urlDuringFailure });
await page.unroute("**/api/machines*");
await page.waitForTimeout(3500);
const afterRecovery = await appState();
record("retry restores the deep-linked machine", afterRecovery.selectedMachine === prodId && afterRecovery.machinesLoad === "loaded", afterRecovery);
record("deep link survives in the address bar", page.url().includes(`machine=${prodId}`), { url: page.url() });
void failRouteActive;
void VISIT;

console.log("== desktop: the panel's machines slot renders the contributed body");
const desktop = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" })).newPage();
desktop.on("dialog", (d) => { void d.accept(); });
await desktop.goto(BASE, { waitUntil: "domcontentloaded" });
await desktop.waitForSelector("pi-web-app", { timeout: 15000 });
await desktop.waitForTimeout(3500);
const panelRows = await desktop.evaluate(`(function(){
  var found={panel:false,machineList:false,rows:0,addButton:false};
  var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var panel=root.querySelector("app-navigation-panel");if(panel&&panel.shadowRoot&&!found.panel){var ml=panel.shadowRoot.querySelector("machine-list");if(ml&&ml.shadowRoot){found.panel=true;found.machineList=true;found.rows=ml.shadowRoot.querySelectorAll("button.action-main").length;found.addButton=ml.shadowRoot.querySelector("button.add-button, .list-search + button, button[aria-label='Add machine']")!==null||ml.shadowRoot.textContent.indexOf("Add")!==-1;}}};
  visit(document);return found;
})()`);
record("panel machines slot renders the plugin's machine-list", panelRows.panel && panelRows.machineList && panelRows.rows >= 2, panelRows);
await desktop.screenshot({ path: "/tmp/waveb-desktop-panel.png", fullPage: false });

const failed = results.filter((r) => !r.ok);
console.log(`\\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length > 0) process.exit(1);
await browser.close();
