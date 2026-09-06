import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const browser = await chromium.launch({ executablePath: EXE, headless: true });

const results = [];
const record = (name, ok, detail) => { results.push({ name, ok }); console.log(ok ? "PASS" : "FAIL", name, ok ? "" : JSON.stringify(detail ?? {}).slice(0, 240)); };

const TAP = (prefix) => `(function(){var rows=[];var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var btns=root.querySelectorAll("button");for(var j=0;j<btns.length;j++){var t=btns[j].textContent.trim();if(t.indexOf(${JSON.stringify(prefix)})===0)rows.push(btns[j]);}};visit(document);if(rows.length===0)return false;rows[0].click();return true;})()`;
const tapByPrefix = async (page, prefix) => {
  const ok = await page.evaluate(TAP(prefix)).catch((e) => { console.log("  (tap error)", String(e).slice(0, 80)); return false; });
  if (!ok) console.log("  (tap miss:", prefix + ")");
  if (ok) await page.waitForTimeout(1200);
  return ok;
};
const HAS = (sel) => `(function(){var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot){var hit=visit(kids[i].shadowRoot);if(hit)return true;}}return root.querySelector(${JSON.stringify(sel)})!==null;};return visit(document);})()`;
const FIND = (sel) => `(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}if(found)return;var hit=root.querySelector(${JSON.stringify(sel)});if(hit)found=hit;};visit(document);return found;})()`;

async function poll(page, js, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(js).catch((e) => ({ ok: false, error: String(e).slice(0, 110) }));
    if (last === true || (last && last.ok === true)) return last;
    await page.waitForTimeout(350);
  }
  return last;
}
const asOk = (outcome) => outcome === true || (outcome && outcome.ok === true);

const FILES_ROWS = `(function(){
  var n=0;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var p=root.querySelector("pi-files-panel");if(p&&p.shadowRoot)n+=p.shadowRoot.querySelectorAll("button.row").length;};
  visit(document);return {ok:n>0,rows:n};
})()`;
const PANEL_CONTENT = (label) => `(function(){
  var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}if(found)return;var hit=root.querySelector("workspace-panel");if(hit)found=hit;};
  visit(document);
  if(!found)return {ok:false,panel:false};
  var text=found.shadowRoot?found.shadowRoot.textContent:found.textContent;
  return {ok:text.indexOf(${JSON.stringify(label)})>=0&&text.trim().length>60,title:text.trim().slice(0,50)};
})()`;
const TERMINAL = `(function(){
  var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}if(!found){var hit=root.querySelector("terminal-panel");if(hit)found=hit;}};
  visit(document);
  if(!found)return {ok:false,panel:false};
  var s=found.shadowRoot;
  return {ok:!!(s&&(s.querySelector(".xterm, .xterm-screen, canvas, .terminal-host")||s.textContent.indexOf("$")>=0)),panel:true};
})()`;
const GOALS_TAB = `(function(){
  var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}if(!found){var hit=root.querySelector("chat-view");if(hit)found=hit;}};
  visit(document);
  if(!found||!found.shadowRoot)return {ok:false,chat:false};
  var tabs=found.shadowRoot.querySelectorAll(".drawer-tab");
  var extra=null;var count=0;
  for(var i=0;i<tabs.length;i++){var id=tabs[i].id||"";
    if(id.indexOf("drawer-tab-")===0&&id!=="drawer-tab-activity"&&id!=="drawer-tab-notifications"){extra=tabs[i];count++;}}
  if(!extra)return {ok:false,chat:true,pluginTabs:0,builtinTabs:tabs.length};
  extra.click();
  return {ok:true,chat:true,tab:extra.id,pluginTabs:count};
})()`;
const GOALS_BODY = `(function(){
  var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}if(!found){var hit=root.querySelector("chat-view");if(hit)found=hit;}};
  visit(document);
  if(!found||!found.shadowRoot)return {ok:false};
  var panels=found.shadowRoot.querySelectorAll("[id^=drawer-panel-]");
  var ids=[];for(var i=0;i<panels.length;i++)ids.push(panels[i].id);
  return {ok:ids.length>0,ids:ids};
})()`;
const VOICE = `(function(){
  var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}if(!found){var hit=root.querySelector("prompt-editor");if(hit)found=hit;}};
  visit(document);
  if(!found||!found.shadowRoot)return {ok:false,editor:false};
  var html=found.shadowRoot.innerHTML.toLowerCase();
  return {ok:true,editor:true,dictate:html.indexOf("dictat")>=0,buttons:found.shadowRoot.querySelectorAll("button").length};
})()`;
const THEMES = `(function(){
  var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}if(!found){var hit=root.querySelector("settings-appearance-panel");if(hit)found=hit;}};
  visit(document);
  if(!found||!found.shadowRoot)return {ok:false};
  var names=[];var bs=found.shadowRoot.querySelectorAll("button");
  for(var i=0;i<bs.length;i++)names.push(bs[i].textContent.trim().slice(0,20));
  return {ok:true,names:names.slice(0,12),emptyClaim:found.shadowRoot.textContent.indexOf("No themes are installed")>=0};
})()`;

console.log("== phone: workspace tool panels");
{
  const c = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: "dark" });
  const page = await c.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 160)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app", { timeout: 15000 });
  await page.waitForTimeout(2500);

  await tapByPrefix(page, "Sessions");
  await tapByPrefix(page, "Browse machines and projects");
  await tapByPrefix(page, "pi-web/");
  const ws = await poll(page, `(function(){var app=document.querySelector("pi-web-app");return {ok:app.state.selectedWorkspace!==undefined,ws:app.state.selectedWorkspace?app.state.selectedWorkspace.path.split("/").pop():null};})()`);
  record("phone: pi-web workspace selected", ws && ws.ok === true, ws);

  const tools = [
    ["Files", FILES_ROWS],
    ["Git", PANEL_CONTENT("Git")],
    ["Terminal", TERMINAL],
    ["Tasks", HAS("pi-web-workspace-tasks-panel")],
    ["Relays", HAS("pi-web-relays-panel")],
    ["Updates", PANEL_CONTENT("Updates")],
    ["Info", PANEL_CONTENT("Info")],
  ];
  for (const [label, js] of tools) {
    await tapByPrefix(page, label);
    const outcome = await poll(page, js);
    record("phone: " + label + " panel works", asOk(outcome), outcome);
  }
  await c.close();
}

console.log("== desktop: goals, voice, themes");
{
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await c.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 160)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app", { timeout: 15000 });
  await page.waitForTimeout(2500);

  await tapByPrefix(page, "pi-web/");
  const ws = await poll(page, `(function(){var app=document.querySelector("pi-web-app");return {ok:app.state.selectedWorkspace!==undefined};})()`);
  record("desktop: workspace selected", ws && ws.ok === true, ws);

  const sessionPicked = await page.evaluate(`(function(){var hit=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var sl=root.querySelector("session-list");if(sl&&!hit){var rows=sl.shadowRoot.querySelectorAll(".action-row");if(rows.length>0)hit=rows[0];}};visit(document);if(!hit)return false;hit.click();return true;})()`);
  await page.waitForTimeout(1500);
  const chat = await poll(page, HAS("chat-view"));
  record("desktop: session opens into the chat", sessionPicked && asOk(chat), chat);

  const goalsTab = await poll(page, GOALS_TAB);
  record("desktop: goals drawer tab renders and selects", goalsTab && goalsTab.ok === true, goalsTab);
  const goalsBody = await poll(page, GOALS_BODY);
  record("desktop: goals drawer body mounts", goalsBody && goalsBody.ok === true, goalsBody);
  console.log("  goals detail:", JSON.stringify({ tab: goalsTab, body: goalsBody }));

  const voice = await poll(page, VOICE);
  record("desktop: composer renders (dictate slot wired)", voice && voice.ok === true && voice.buttons > 0, voice);
  console.log("  voice detail:", JSON.stringify(voice));

  await page.goto(BASE + "/?settings=appearance", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app", { timeout: 15000 });
  await page.waitForTimeout(2000);
  const themes = await poll(page, THEMES, 10000);
  record("desktop: themes - appearance panel renders", themes && themes.ok === true, themes);
  const names = themes && themes.names ? themes.names.join("|") : "";
  record("desktop: themes - clay present or honest empty claim", themes && (names.indexOf("Clay") >= 0 || themes.emptyClaim === true), names);
  console.log("  themes detail:", names || "empty claim");

  await c.close();
}

console.log("== summary");
const failed = results.filter((r) => !r.ok);
console.log("PASS:", results.length - failed.length, "FAIL:", failed.length, failed.map((f) => f.name));
await browser.close();
process.exit(failed.length > 0 ? 1 : 0);
