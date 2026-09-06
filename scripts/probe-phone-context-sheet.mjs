import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: "dark" })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 160)));

const results = [];
const record = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? "PASS" : "FAIL", name, ok ? "" : JSON.stringify(detail ?? {}).slice(0, 240)); };

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("pi-web-app", { timeout: 15000 });
await page.waitForTimeout(3000);

const TAP = (prefix) => `(function(){var rows=[];var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var btns=root.querySelectorAll("button");for(var j=0;j<btns.length;j++){var t=btns[j].textContent.trim();if(t.indexOf(${JSON.stringify(prefix)})===0)rows.push(btns[j]);}};visit(document);if(rows.length===0)return false;rows[0].click();return true;})()`;
const tap = async (prefix) => { const ok = await page.evaluate(TAP(prefix)).catch(() => false); if (ok) await page.waitForTimeout(1000); return ok; };
const panelGridVisible = () => page.evaluate(`(function(){var hit=false;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}if(!hit){var p=root.querySelector("app-navigation-panel");if(p&&p.shadowRoot&&p.shadowRoot.querySelector(".tools-section"))hit=true;}};visit(document);return hit;})()`);

console.log("== boot: pick the pi-web project and its first workspace");
await tap("Sessions");
await tap("Browse machines and projects");
await tap("pi-web/");
await page.waitForTimeout(1500);
await page.evaluate(`(function(){
  var target=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var wl=root.querySelector("workspace-list");if(wl&&wl.shadowRoot){var rows=wl.shadowRoot.querySelectorAll("button.action-main");if(rows.length>0)target=rows[0];}};
  visit(document);if(target)target.click();
})()`);
await page.waitForTimeout(1500);
const boot = await page.evaluate(`(function(){var app=document.querySelector("pi-web-app");return {project:app.state.selectedProject?app.state.selectedProject.name:null,ws:app.state.selectedWorkspace?app.state.selectedWorkspace.id:null};})()`);
record("boot: pi-web workspace selected", boot.project !== null && boot.ws !== null, boot);

console.log("== tools grid visible on the sessions section");
const gridOnSessions = await panelGridVisible();
record("grid visible on the sessions section", gridOnSessions, {});

console.log("== scope chip opens the context sheet");
await page.evaluate(`(function(){var hit=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var btns=root.querySelectorAll("button");for(var j=0;j<btns.length;j++){if((btns[j].getAttribute("aria-label")||"")==="Change machine, project or workspace")hit=btns[j];}};visit(document);if(hit)hit.click();})()`);
await page.waitForTimeout(1200);
const sheetState = await page.evaluate(`(function(){
  var found={sheet:false,projectRows:0,workspaceRows:0,currentMarked:false};
  var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var cs=root.querySelector("context-switcher-sheet");if(cs&&!found.sheet){found.sheet=true;var pl=cs.shadowRoot?cs.shadowRoot.querySelector("project-list"):null;if(pl&&pl.shadowRoot){found.projectRows=pl.shadowRoot.querySelectorAll(".action-row").length;var sel=pl.shadowRoot.querySelector(".action-row.selected");if(sel)found.currentMarked=true;}var wl=cs.shadowRoot?cs.shadowRoot.querySelector("workspace-list"):null;if(wl&&wl.shadowRoot)found.workspaceRows=wl.shadowRoot.querySelectorAll(".action-row").length;}};
  visit(document);return found;
})()`);
record("context sheet opens from the chip", sheetState.sheet, sheetState);
record("sheet lists projects with the current one marked", sheetState.projectRows > 0 && sheetState.currentMarked, sheetState);
record("sheet lists the project's workspaces", sheetState.workspaceRows > 0, sheetState);
await page.screenshot({ path: "/tmp/context-sheet.png" });

console.log("== picking another project switches scope and closes the sheet");
const before = await page.evaluate(`(function(){var app=document.querySelector("pi-web-app");return app.state.selectedProject?app.state.selectedProject.name:null;})()`);
const pickOk = await page.evaluate(`(function(){
  var target=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var cs=root.querySelector("context-switcher-sheet");if(cs){var pl=cs.shadowRoot?cs.shadowRoot.querySelector("project-list"):null;if(pl&&pl.shadowRoot){var rows=pl.shadowRoot.querySelectorAll(".action-row");for(var j=0;j<rows.length;j++){if(rows[j].className.indexOf("selected")<0){target=rows[j].querySelector("button.action-main");break;}}}}};
  visit(document);if(!target)return false;target.click();return true;
})()`);
await page.waitForTimeout(1600);
const after = await page.evaluate(`(function(){
  var app=document.querySelector("pi-web-app");
  var open=false;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}if(root.querySelector("context-switcher-sheet"))open=true;};
  visit(document);
  return {open:open,project:app.state.selectedProject?app.state.selectedProject.name:null};
})()`);
record("pick switches the project and closes the sheet", pickOk && !after.open && after.project !== null && after.project !== before, { pickOk, before, after });

console.log("== tools grid follows the visible section after the pick");
const sectionState = await page.evaluate(`(function(){
  var out={grid:false,visibleSection:null};
  var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var p=root.querySelector("app-navigation-panel");if(p&&p.shadowRoot){out.grid=p.shadowRoot.querySelector(".tools-section")!==null;var lists=["machine-list","project-list","workspace-list","session-list"];for(var i=0;i<lists.length;i++){var el=p.shadowRoot.querySelector(lists[i]);if(el&&el.hidden!==true)out.visibleSection=lists[i];}}};
  visit(document);return out;
})()`);
record("grid visibility matches the sessions section", sectionState.grid === (sectionState.visibleSection === "session-list"), sectionState);

console.log("== tool view without a session keeps the labeled exit");
await page.evaluate(`(function(){
  var target=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var wl=root.querySelector("workspace-list");if(wl&&wl.shadowRoot){var rows=wl.shadowRoot.querySelectorAll("button.action-main");if(rows.length>0)target=rows[0];}};
  visit(document);if(target)target.click();
})()`);
await page.waitForTimeout(1500);
await tap("Files");
await page.waitForTimeout(1200);
const toolExit = await page.evaluate(`(function(){
  var hit=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var btns=root.querySelectorAll("button");for(var j=0;j<btns.length;j++){var al=btns[j].getAttribute("aria-label")||"";if(al==="Open panel"||al==="Close panel")hit=btns[j];}};
  visit(document);
  var app=document.querySelector("pi-web-app");
  return {toggle:hit!==null,view:app.state.mainView};
})()`);
record("tool view shows the panel toggle (exit)", toolExit.toggle && toolExit.view !== "navigation" && toolExit.view !== "chat", toolExit);
await page.evaluate(`(function(){
  var hit=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var btns=root.querySelectorAll("button");for(var j=0;j<btns.length;j++){var al=btns[j].getAttribute("aria-label")||"";if(al==="Open panel"||al==="Close panel")hit=btns[j];}};
  visit(document);if(hit)hit.click();
})()`);
await page.waitForTimeout(1500);
const backInPanel = await page.evaluate(`(function(){
  var app=document.querySelector("pi-web-app");
  var panel=false;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var p=root.querySelector("app-navigation-panel");if(p&&p.offsetParent!==null)panel=true;};
  visit(document);
  return {panel:panel,view:app.state.mainView};
})()`);
record("toggle returns to the panel", backInPanel.view === "navigation", backInPanel);

const failed = results.filter((r) => !r.ok);
console.log("== summary: PASS", results.length - failed.length, "FAIL", failed.length, failed.map((f) => f.name));
await browser.close();
process.exit(failed.length > 0 ? 1 : 0);
