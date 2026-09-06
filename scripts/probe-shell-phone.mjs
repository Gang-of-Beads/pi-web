import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: "dark" });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 200)));

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("pi-web-app", { timeout: 15000 });
await page.waitForTimeout(3000);

const DEEP_FIND = `(function(sel, text){
  const visit = (root) => {
    for (const node of root.querySelectorAll("*")) {
      if (sel && node.matches(sel)) return node;
      if (node.shadowRoot) { const hit = visit(node.shadowRoot); if (hit) return hit; }
    }
    return null;
  };
  const found = visit(document);
  if (!found) return null;
  if (!text) return found;
  const visitText = (root) => {
    for (const node of root.querySelectorAll("button, [role=button], a")) {
      if (node.textContent.trim() === text) return node;
    }
    for (const node of root.querySelectorAll("*")) {
      if (node.shadowRoot) { const hit = visitText(node.shadowRoot); if (hit) return hit; }
    }
    return null;
  };
  return visitText(found.shadowRoot ?? document);
})`;

async function tapByLabel(prefix, label) {
  const needle = JSON.stringify(prefix);
  const ok = await page.evaluate(`(function(){
    const rows=[];
    const visit=(root)=>{for(const node of root.querySelectorAll("*")){if(node.shadowRoot)visit(node.shadowRoot);}
      for(const node of root.querySelectorAll("button, [role=button]")){const t=node.textContent.trim();if(t.indexOf(${needle})===0)rows.push(node);}};
    visit(document);
    if(rows.length===0)return false;
    rows[0].click();
    return true;
  })()`);
  console.log(label, ok ? "tapped" : "NOT FOUND");
  if (!ok) return false;
  await page.waitForTimeout(2500);
  return true;
}

async function dump(label) {
  const s = await page.evaluate(`(function(){
    const visit=(root,sel)=>{for(const node of root.querySelectorAll("*")){if(node.matches(sel))return node;if(node.shadowRoot){const hit=visit(node.shadowRoot,sel);if(hit)return hit;}}return null;};
    const panel=visit(document,"app-navigation-panel");
    const app=document.querySelector("pi-web-app");
    const sl=panel?panel.shadowRoot.querySelector("session-list"):null;
    const sessRows=sl?Array.from(sl.shadowRoot.querySelectorAll("button")).map(n=>String(n.className).split(" ")[0]+"|"+n.textContent.trim().slice(0,16)):null;
    const tools=panel?Array.from(panel.shadowRoot.querySelectorAll(".tool-row")).map(b=>b.textContent.trim()):null;
    const filesPanel=visit(document,"pi-files-panel");
    const filesTree=filesPanel?visit(document,"pi-files-panel").shadowRoot.querySelectorAll("[class*=tree], [class*=row], li").length:0;
    const st=app&&app.state?app.state:{};
    return {url:location.search.slice(0,80),view:st.mainView,ws:st.selectedWorkspace?st.selectedWorkspace.path.split("/").pop():"none",sessRows:(sessRows===null?"absent":sessRows.length+" rows "+JSON.stringify(sessRows.slice(0,3))),stSessions:Array.isArray(st.sessions)?st.sessions.length:"?",stLoad:st.sessionsLoad,stSel:st.selectedSession?st.selectedSession.id.slice(0,10):"none",tools:tools===null?"absent":JSON.stringify(tools),filesPanel:!!filesPanel};
  })()`);
  console.log(label, JSON.stringify(s));
}

console.log("== journey start");
await dump("boot:");
await page.screenshot({ path: "/tmp/p1-boot.png" });

await tapByLabel("Sessions", "chip");
await page.screenshot({ path: "/tmp/p2-sheet.png" });
await dump("sheet:");

await tapByLabel("Browse machines and projects", "browse");
await page.screenshot({ path: "/tmp/p3-projects.png" });
await dump("projects:");

await tapByLabel("pi-web/", "project");
await tapByLabel("refactor/", "workspace-row");
await page.screenshot({ path: "/tmp/p4-workspaces.png" });
await dump("workspaces:");

const wsTap = await page.evaluate(`(function(){
  const visit=(root,sel)=>{for(const node of root.querySelectorAll("*")){if(node.matches(sel))return node;if(node.shadowRoot){const hit=visit(node.shadowRoot,sel);if(hit)return hit;}}return null;};
  const list=visit(document,"workspace-list");
  if(!list)return "no workspace-list";
  const row=Array.from(list.shadowRoot.querySelectorAll("button")).find(b=>b.textContent.includes("8505")||b.textContent.includes("pi-web"));
  if(!row)return "no row: "+Array.from(list.shadowRoot.querySelectorAll("button")).map(b=>b.textContent.trim().slice(0,20)).join("|");
  row.click();
  return "tapped "+row.textContent.trim().slice(0,30);
})()`);
console.log("workspace:", wsTap);
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/p5-sessions.png" });
await dump("sessions:");

const sessionTap = await page.evaluate(`(function(){
  const visit=(root,sel)=>{for(const node of root.querySelectorAll("*")){if(node.matches(sel))return node;if(node.shadowRoot){const hit=visit(node.shadowRoot,sel);if(hit)return hit;}}return null;};
  const sl=visit(document,"session-list");
  const row=Array.from(sl.shadowRoot.querySelectorAll("button")).find(b=>String(b.className).indexOf("session")===0||String(b.className).includes("session-entry")||String(b.className).includes("session-row"));
  if(!row)return "no session row: "+Array.from(sl.shadowRoot.querySelectorAll("button")).map(b=>String(b.className).split(" ")[0]).join(",");
  row.click();return "tapped "+row.textContent.trim().slice(0,20);
})()`);
console.log("session:", sessionTap);
await page.waitForTimeout(2000);
await page.screenshot({ path: "/tmp/p6-session.png" });
await dump("in-session:");

await tapByLabel("Files", "tool-files");
await page.screenshot({ path: "/tmp/p7-files.png" });
await dump("after-files:");

await page.goBack();
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/p8-back-from-tool.png" });
await dump("back-from-tool:");

await page.goBack();
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/p9-back-from-chat.png" });
await dump("back-from-chat:");
await page.screenshot({ path: "/tmp/p6-files.png" });
await dump("after-files:");

await page.goBack();
await page.waitForTimeout(1000);
await page.screenshot({ path: "/tmp/p7-back.png" });
await dump("after-back:");

await browser.close();
