import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const PROBE_DIR = "/tmp/pi-web-8505-wavea-probe";
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: "dark" })).newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 160)));

const results = [];
const record = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? "PASS" : "FAIL", name, ok ? "" : JSON.stringify(detail ?? {}).slice(0, 300)); };

const VISIT = `(function(node){var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}if(!node&&root!==document)visitNode(root);};var visitNode=function(el){};return null;})()`;
const tapText = (prefix) => `(function(){var rows=[];var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var btns=root.querySelectorAll("button");for(var j=0;j<btns.length;j++){var t=btns[j].textContent.trim();if(t.indexOf(${JSON.stringify(prefix)})===0)rows.push(btns[j]);}};visit(document);if(rows.length===0)return false;rows[0].click();return true;})()`;
const tap = async (prefix) => { const ok = await page.evaluate(tapText(prefix)).catch(() => false); if (ok) await page.waitForTimeout(1200); return ok; };
const appState = () => page.evaluate(`(function(){var app=document.querySelector("pi-web-app");return {project:app.state.selectedProject?app.state.selectedProject.name:null,ws:app.state.selectedWorkspace?app.state.selectedWorkspace.id:null,projects:(app.state.projects||[]).length};})()`);

console.log("== boot: pick the pi-web project and its first workspace");
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("pi-web-app", { timeout: 15000 });
await page.waitForTimeout(3000);
await tap("Sessions");
await tap("Browse machines and projects");
await tap("pi-web/");
await page.waitForTimeout(1500);
await page.evaluate(`(function(){
  var target=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var wl=root.querySelector("workspace-list");if(wl&&wl.shadowRoot){var rows=wl.shadowRoot.querySelectorAll("button.action-main");if(rows.length>0)target=rows[0];}};
  visit(document);if(target)target.click();
})()`);
await page.waitForTimeout(1500);
const boot = await appState();
record("boot: pi-web workspace selected", boot.project !== null && boot.ws !== null, boot);

console.log("== contributed pickers render inside the context sheet");
await page.evaluate(`(function(){var hit=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var btns=root.querySelectorAll("button");for(var j=0;j<btns.length;j++){if((btns[j].getAttribute("aria-label")||"")==="Change machine, project or workspace")hit=btns[j];}};visit(document);if(hit)hit.click();})()`);
await page.waitForTimeout(1200);
const sheet = await page.evaluate(`(function(){
  var found={sheet:false,pluginPicker:false,projectRows:0,currentMarked:false};
  var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var cs=root.querySelector("context-switcher-sheet");if(cs&&cs.shadowRoot&&!found.sheet){found.sheet=true;var pl=cs.shadowRoot.querySelector("project-list");if(pl&&pl.shadowRoot){found.pluginPicker=pl.tagName.toLowerCase()==="project-list";found.projectRows=pl.shadowRoot.querySelectorAll(".action-row").length;found.currentMarked=pl.shadowRoot.querySelector(".action-row.selected")!==null;}}};
  visit(document);return found;
})()`);
record("sheet renders the plugin's project picker", sheet.sheet && sheet.pluginPicker && sheet.projectRows > 0 && sheet.currentMarked, sheet);
await page.screenshot({ path: "/tmp/wavea-sheet.png" });
await page.evaluate(`(function(){var hit=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var btns=root.querySelectorAll("button");for(var j=0;j<btns.length;j++){if(btns[j].getAttribute("aria-label")==="Close context sheet")hit=btns[j];}};visit(document);if(hit)hit.click();})()`);
await page.waitForTimeout(800);

console.log("== add a project through the plugin's dialog");
await tap("Actions");
await page.waitForTimeout(800);
const paletteHasAdd = await page.evaluate(tapText("Add project"));
record("palette runs the plugin's Add project action", paletteHasAdd, {});
await page.waitForTimeout(1200);
const dialogOpen = await page.evaluate(`(function(){var hit=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var pd=root.querySelector("project-dialog");if(pd&&pd.shadowRoot&&pd.shadowRoot.querySelector("input"))hit=pd;};visit(document);return hit!==null;})()`);
record("plugin dialog opens inside the shell's seam", dialogOpen, {});
const typed = await page.evaluate(`(function(){
  var inp=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var pd=root.querySelector("project-dialog");if(pd&&pd.shadowRoot){var found=pd.shadowRoot.querySelector("label input");if(found)inp=found;}};visit(document);if(!inp)return false;
  var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;
  setter.call(inp, ${JSON.stringify(PROBE_DIR)});
  inp.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  return true;
})()`);
if (typed) {
  await page.waitForTimeout(4200);
  const suggestions = await page.evaluate(`(function(){var el=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var pd=root.querySelector("project-dialog");if(pd&&pd.shadowRoot)el=pd;};visit(document);return el;})()`);
  const suggestionRows = await page.evaluate(`(function(){var pd=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var found=root.querySelector("project-dialog");if(found&&found.shadowRoot)pd=found;};visit(document);return pd;})()`);
  const rowTexts = await page.evaluate(`(function(){var out=[];var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var pd=root.querySelector("project-dialog");if(pd&&pd.shadowRoot){pd.shadowRoot.querySelectorAll(".suggestions button").forEach(function(b){out.push(b.textContent.trim());});}};visit(document);return out;})()`);
  record("suggestions search below the typed path", Array.isArray(rowTexts) && rowTexts.some((t) => t.startsWith(PROBE_DIR)), rowTexts.slice(0, 3));
  const trustState = await page.evaluate(`(function(){var out={boxes:0,secondExists:null,secondDisabled:null,trustError:null,hints:[]};var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var pd=root.querySelector("project-dialog");if(pd&&pd.shadowRoot){var boxes=pd.shadowRoot.querySelectorAll("input[type='checkbox']");out.boxes=boxes.length;var second=boxes[1];out.secondExists=second!==undefined;out.secondDisabled=second===undefined?null:second.disabled;var err=pd.shadowRoot.querySelector(".trust-error");out.trustError=err===null?null:err.textContent.trim().slice(0,140);pd.shadowRoot.querySelectorAll("small").forEach(function(x){out.hints.push((x.className||"plain")+":"+(x.textContent||"").trim().slice(0,50));});}};visit(document);return out;})()`);
  record("trust row resolves for the typed path", trustState.boxes === 2 && trustState.secondExists === true && trustState.secondDisabled === false && trustState.trustError === null, trustState);
  await page.screenshot({ path: "/tmp/wavea-dialog.png" });
  await tap("Add project");
  await page.waitForTimeout(3000);
}
const afterAdd = await appState();
record("project created and its workspace selected", afterAdd.project !== null && afterAdd.project !== boot.project, afterAdd);

console.log("== the new project's files ride the plugin routes");
await tap("Files");
await page.waitForTimeout(2000);
const treeRows = await page.evaluate(`(function(){var n=0;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var panel=root.querySelector("pi-files-panel");if(panel&&panel.shadowRoot){n=panel.shadowRoot.querySelectorAll("button").length;}};visit(document);return n;})()`);
record("files tree renders through the plugin routes", treeRows > 0, { rows: treeRows });
const wrote = await page.evaluate(async (dir) => {
  var app = document.querySelector("pi-web-app");
  var ws = app.state.selectedWorkspace;
  var res = await fetch("/api/projects/" + ws.projectId + "/workspaces/" + ws.id + "/file?path=" + encodeURIComponent("probe-wavea.md"), { method: "PUT", headers: { "content-type": "text/plain" }, body: "# wave a probe\\n\\nwritten through the plugin route.\\n" });
  return { status: res.status, ok: res.ok };
}, PROBE_DIR);
record("file write through the plugin route", wrote.ok === true, wrote);
const readBack = await page.evaluate(async () => {
  var app = document.querySelector("pi-web-app");
  var ws = app.state.selectedWorkspace;
  var res = await fetch("/api/projects/" + ws.projectId + "/workspaces/" + ws.id + "/file?path=" + encodeURIComponent("probe-wavea.md"));
  var payload = await res.json();
  var text = typeof payload.content === "string" ? payload.content : (payload.content && payload.content.text) || JSON.stringify(payload).slice(0, 60);
  return { status: res.status, text: String(text).slice(0, 40) };
});
record("file reads back through the plugin route", readBack.status === 200 && (readBack.text ?? "").includes("wave a probe"), readBack);
await page.evaluate(`(function(){var hit=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var panel=root.querySelector("pi-files-panel");if(panel&&panel.shadowRoot){var btns=panel.shadowRoot.querySelectorAll("button");for(var j=0;j<btns.length;j++){var t=btns[j].getAttribute("aria-label")||btns[j].textContent.trim();if(t.toLowerCase().indexOf("refresh")!==-1||t.toLowerCase().indexOf("reload")!==-1)hit=btns[j];}}};visit(document);if(hit)hit.click();})()`);
await page.waitForTimeout(1500);
const probeRow = await page.evaluate(`(function(){var hit=false;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var panel=root.querySelector("pi-files-panel");if(panel&&panel.shadowRoot){panel.shadowRoot.querySelectorAll("button").forEach(function(b){if(b.textContent.trim().indexOf("probe-wavea.md")!==-1)hit=true;});}};visit(document);return hit;})()`);
record("written file appears in the tree after refresh", probeRow, {});
await page.screenshot({ path: "/tmp/wavea-files.png" });

console.log("== remove the probe project (delete)");
await tap("Sessions");
await page.waitForTimeout(800);
await tap("Browse machines and projects");
await page.waitForTimeout(800);
await tap("pi-web/");
await page.waitForTimeout(1500);
await page.evaluate(`(function(){
  var target=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var wl=root.querySelector("workspace-list");if(wl&&wl.shadowRoot){var rows=wl.shadowRoot.querySelectorAll("button.action-main");if(rows.length>0)target=rows[0];}};
  visit(document);if(target)target.click();
})()`);
await page.waitForTimeout(1200);
const restored = await appState();
record("scope restored to a real project", restored.project === boot.project, restored);

console.log("");
console.log("== summary: " + results.filter((r) => r.ok).length + "/" + results.length + " PASS");
results.filter((r) => !r.ok).forEach((r) => console.log("FAILED:", r.name));
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
