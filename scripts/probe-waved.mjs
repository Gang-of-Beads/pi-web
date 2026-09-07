import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:8505";
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/* Every component renders into a shadow root, so all queries walk shadow
   roots explicitly; a document-level selector here would pass vacuously. */
const deepAll = (selector) => `(function(){
  var out=[];
  var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}var found=root.querySelectorAll(${JSON.stringify(selector)});for(var j=0;j<found.length;j++)out.push(found[j]);};
  visit(document);
  if(document.querySelector(${JSON.stringify(selector)})){var d=document.querySelectorAll(${JSON.stringify(selector)});for(var k=0;k<d.length;k++)out.push(d[k]);}
  return out;
})()`;
const deepCount = (selector) => `(${deepAll(selector)}).length`;
const deepText = () => `(function(){
  var t=function(root){var s=root.textContent||"";var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)s+="\\n"+t(kids[i].shadowRoot);}};
  var all=function(root){var s=root.textContent||"";var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)s+="\\n"+all(kids[i].shadowRoot);}};
  return all(document);
})()`;
const deepQuerySingle = (selector) => `(function(){
  var hit=null;
  var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!hit)visit(kids[i].shadowRoot);}};
  visit(document);
  var top=document.querySelectorAll(${JSON.stringify(selector)});
  var nodes=[];
  var walk=function(root){var found=root.querySelectorAll(${JSON.stringify(selector)});for(var j=0;j<found.length;j++)nodes.push(found[j]);var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};
  walk(document);
  return nodes.length>0?{tag:nodes[0].tagName,label:nodes[0].getAttribute("aria-label")||nodes[0].textContent.trim().slice(0,40)}:null;
})()`;

const browser = await chromium.launch({ executablePath: EXE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);

  // Boot: navigation surface only, no chat open yet.
  const bootBody = await page.evaluate(deepText());
  check("no notifications chrome anywhere at boot", !/Notifications/i.test(bootBody));
  const bootTabs = await page.evaluate(`${deepAll(".drawer-tab-label")}.map(function(n){return n.textContent.trim();})`);
  check("no built-in Activity/Notifications tabs at boot", bootTabs.every((t) => !/^(Activity|Notifications)/.test(t)), bootTabs.join("|") || "no tabs");
  const bootDrawerToggle = await page.evaluate(`${deepAll(".drawer-toggle")}.length`);
  check("drawer absent when no sections are contributed", bootDrawerToggle === 0, `toggles=${String(bootDrawerToggle)}`);
  const dockButtons = await page.evaluate(`${deepAll("button.activity-dock")}.length`);
  check("dock is never a button", dockButtons === 0, `buttons=${String(dockButtons)}`);

  // Drill into a chat: project tile, then the first session row.
  await page.evaluate(`(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&kids[i].tagName==="PROJECT-LIST")found=kids[i];}};visit(document);if(!found)return;var el=found.shadowRoot.querySelector("button.action-main");if(el)el.click();})()`);
  await page.waitForTimeout(2200);
  await page.evaluate(`(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&kids[i].tagName==="SESSION-LIST")found=kids[i];}};visit(document);if(!found)return;var el=found.shadowRoot.querySelector(".action-row .action-main");if(el)el.click();})()`);
  await page.waitForTimeout(2500);

  const composer = await page.evaluate(deepCount("prompt-editor"));
  check("composer present once a chat is open", composer > 0, `prompt-editors=${String(composer)}`);

  // The drawer-present leg: with the goals plugin contributing, the drawer
  // must exist and its tabs must name contributed sections only.
  const chatTabs = await page.evaluate(`${deepAll(".drawer-tab-label")}.map(function(n){return n.textContent.trim();})`);
  check("drawer shows contributed sections only in chat", chatTabs.length > 0 && chatTabs.every((t) => !/^(Activity|Notifications)/.test(t)), chatTabs.join("|") || "no tabs");
  const chatBody = await page.evaluate(deepText());
  check("no notifications chrome in the open chat", !/Notifications/i.test(chatBody));
  const dockInfo = await page.evaluate(deepQuerySingle(".activity-dock.background"));
  check("background dock renders as a div, never a button", dockInfo === null || dockInfo.tag === "DIV", dockInfo === null ? "no live background work" : dockInfo.tag);
  const dockClickHandler = await page.evaluate(`(function(){
    var nodes=[];var walk=function(root){var found=root.querySelectorAll(".activity-dock");for(var j=0;j<found.length;j++)nodes.push(found[j]);var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot)walk(kids[i].shadowRoot);}};
    walk(document);
    return nodes.every(function(n){return n.tagName==="DIV";});
  })()`);
  check("every rendered dock element is a non-interactive div", dockClickHandler === true);

  await page.screenshot({ path: "/tmp/waved2-phone.png", fullPage: false });

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await desktop.goto(BASE, { waitUntil: "domcontentloaded" });
  await desktop.waitForTimeout(2200);
  const dTabs = await desktop.evaluate(`${deepAll(".drawer-tab-label")}.map(function(n){return n.textContent.trim();})`);
  check("desktop: contributed sections only", dTabs.every((t) => !/^(Activity|Notifications)/.test(t)), dTabs.join("|") || "no tabs");
  await desktop.screenshot({ path: "/tmp/waved2-desktop.png", fullPage: false });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
