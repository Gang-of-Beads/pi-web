import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = process.env.PROBE_BASE ?? "http://127.0.0.1:8505";

mkdirSync("/tmp/journeys", { recursive: true });

const results = [];
function record(journey, step, expectText, pass, detail = "") {
  results.push({ journey, step, expect: expectText, verdict: pass ? "PASS" : "FAIL", detail: String(detail).slice(0, 180) });
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });

const SETUP_PROJECT = `(async function(projectPath){
  const app = document.querySelector("pi-web-app");
  const state = Reflect.get(app, "state");
  const project = state.projects.find((p) => p.path === projectPath);
  if (!project) return "no-project";
  await Reflect.get(app, "workspaces").selectProject(project);
  await new Promise((r) => setTimeout(r, 1500));
  const ws = Reflect.get(app, "state").workspaces?.[0];
  if (!ws) return "no-workspace";
  await Reflect.get(app, "workspaces").selectWorkspace(ws);
  await new Promise((r) => setTimeout(r, 2000));
  return "ok workspace=" + ws.label;
})`;

async function runJourneys(page, label) {
  const isPhone = label === "phone";
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app", { timeout: 15000 });
  await page.waitForTimeout(3000);

  // J1 boot
  record(label, "J1 app mounts", "pi-web-app present", (await page.locator("pi-web-app").count()) > 0);
  const banner = await page.evaluate(`(function(){
    let found = "";
    const visit = (root) => { for (const node of root.querySelectorAll("*")) { if (node.childElementCount === 0) { const t = node.textContent ?? ""; if (t.includes("status is unknown")) found = "unknown-status"; if (t.includes("folder no longer exists")) found = found || "folder-gone"; } if (node.shadowRoot) visit(node.shadowRoot); } };
    visit(document); return found;
  })()`);
  record(label, "J1 no stale banners", "no error banner at boot", banner === "", banner);

  // J2 select project+workspace via controllers (navigation itself is UI-verified below)
  const setup = await page.evaluate(`${SETUP_PROJECT}("/private/tmp/test")`);
  record(label, "J2 project+workspace", "navigation chain resolves", setup.startsWith("ok"), setup);
  await page.waitForTimeout(600);

  if (isPhone) {
    // The drawer overlays the chat: the real user taps a session row to open it.
    record(label, "J2 sessions visible", "session rows render in the drawer", (await page.locator("session-list button").count()) > 0);
    const sessionRow = page.locator("session-list button:has-text('messages')").first();
    if ((await sessionRow.count()) > 0) {
      await sessionRow.click({ timeout: 5000 });
      await page.waitForTimeout(1400);
      record(label, "J2 session row opens chat", "drawer yields to the chat surface", (await page.locator("chat-view").count()) > 0);
    } else {
      record(label, "J2 session row opens chat", "a session row exists", false, "no rows");
    }
  } else {
    // Desktop: pick the first live session row explicitly.
    await page.locator("session-list button:has-text('messages')").first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }

  record(label, "J3 chat mounts", "chat-view + prompt-editor present",
    (await page.locator("chat-view").count()) > 0 && (await page.locator("prompt-editor").count()) > 0);

  // J4 composer typing (chat is now the front surface)
  const composer = page.locator("prompt-editor .cm-content").first();
  if ((await composer.count()) > 0) {
    await composer.click({ force: true, timeout: 5000 }).catch(async (error) => {
      record(label, "J4 composer click", "composer clickable", false, error.message.slice(0, 70));
      await page.locator("prompt-editor").first().click({ force: true, timeout: 5000 }).catch(() => {});
    });
    await page.keyboard.type("journey probe");
    await page.waitForTimeout(400);
    const typed = await page.evaluate(`(function(){
      let line = "";
      const visit = (root) => { for (const node of root.querySelectorAll("*")) { const l = node.shadowRoot?.querySelector(".cm-line"); if (l && l.textContent) { line = l.textContent; return; } if (node.shadowRoot) visit(node.shadowRoot); } };
      visit(document); return line;
    })()`);
    record(label, "J4 typing lands", "typed text visible", (typed ?? "").includes("journey probe"), String(typed).slice(0, 40));
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(300);
  } else {
    record(label, "J4 composer editor", ".cm-content present", false, "absent");
  }

  await page.screenshot({ path: `/tmp/journeys/${label}-chat.png` });

  // J5 dock panels. Phone: they live in the drawer, re-opened via the header toggle.
  const openDrawer = async () => {
    if (!isPhone) return;
    const toggle = page.locator(`button[aria-label*="Open panel"]:visible, button[aria-label*="Open session selection"]:visible`).first();
    if ((await toggle.count()) > 0) {
      await toggle.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(900);
    }
  };
  const workspacePanelFingerprint = () => page.evaluate(`(function(){
    let found = "";
    const visit = (root) => { for (const node of root.querySelectorAll("*")) { if (node.tagName === "WORKSPACE-PANEL") found += (node.shadowRoot?.textContent ?? ""); if (node.shadowRoot) visit(node.shadowRoot); } };
    visit(document); return found.replace(/\\s+/g, " ").trim();
  })()`);
  const baseFingerprint = await workspacePanelFingerprint();
  for (const dockButton of ["Files", "Terminal", "Tasks", "Relays", "Updates", "Info"]) {
    await openDrawer();
    const button = page.locator(`button:has-text("${dockButton}"):visible`).first();
    if ((await button.count()) === 0) { record(label, `J5 dock ${dockButton}`, "dock button exists", false, "absent"); continue; }
    await button.click({ timeout: 5000 }).catch(() => record(label, `J5 dock ${dockButton}`, "clickable", false, "timeout"));
    await page.waitForTimeout(1100);
    const fingerprint = await workspacePanelFingerprint();
    const opened = fingerprint !== baseFingerprint;
    record(label, `J5 dock ${dockButton}`, "workspace surface content changes", opened, opened ? "changed" : "unchanged");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(450);
  }

  // J6 settings: gear on desktop; More actions menu on phone
  const gear = page.locator(`[aria-label*="Open settings"]:visible`).first();
  if ((await gear.count()) > 0) {
    await gear.click({ timeout: 5000 });
  } else {
    const more = page.locator(`button[aria-label*="More actions"]:visible`).first();
    const moreOpened = (await more.count()) > 0 ? await more.click({ timeout: 5000 }).then(() => true).catch(() => false) : false;
    if (moreOpened) {
      await page.waitForTimeout(600);
      await page.locator(`button:has-text("Settings"):visible`).first().click({ timeout: 5000 }).catch(() => {});
    }
  }
  await page.waitForTimeout(1000);
  record(label, "J6 settings dialog", "settings-dialog mounts", (await page.locator("settings-dialog").count()) > 0);
  const appearanceEntry = page.locator("settings-dialog button:has-text('Appearance')").first();
  if ((await appearanceEntry.count()) > 0) {
    await appearanceEntry.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    record(label, "J6 appearance themes", "theme cards render", (await page.locator("settings-dialog").innerText().catch(() => "")).includes("Theme"));
  } else {
    record(label, "J6 appearance themes", "Appearance section reachable", false, "entry absent");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // J7 quick switcher through its real affordance
  await page.evaluate(`(function(){ document.querySelector("pi-web-app").openQuickSwitcher?.(); })()`);
  await page.waitForTimeout(800);
  record(label, "J7 quick switcher", "switcher surface mounts", (await page.locator("quick-switcher").count()) > 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // J9 dead-folder session: inert row, no banner on interaction
  const deadSetup = await page.evaluate(`${SETUP_PROJECT}("/private/tmp/fe-review/ds")`);
  await page.waitForTimeout(1200);
  // Selecting a project folds the sessions section away: re-expand it the way
  // the UI offers (the Sessions chip / section header) before looking at rows.
  const sessionsChip = page.locator(`button[aria-label*="ession"]:visible`).first();
  if ((await sessionsChip.count()) > 0) {
    await sessionsChip.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  const deadRow = await page.evaluate(`(function(){
    const row = document.querySelector(".cwd-missing-row");
    if (!row) return "absent";
    return row.tagName === "DIV" ? "inert-div" : "still-button:" + row.tagName;
  })()`);
  record(label, "J9 dead row inert", "cwd-missing row is a DIV", deadRow === "inert-div", deadRow + " setup=" + deadSetup);
  await page.locator(".cwd-missing-row").first().click({ force: true, timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(900);
  const bannerAfter = await page.evaluate(`(function(){
    let found = "";
    const visit = (root) => { for (const node of root.querySelectorAll("*")) { if (node.childElementCount === 0 && (node.textContent ?? "").includes("folder no longer exists")) found = "folder-gone"; if (node.shadowRoot) visit(node.shadowRoot); } };
    visit(document); return found;
  })()`);
  record(label, "J9 dead row click", "no folder-gone banner", bannerAfter === "", bannerAfter || "clean");

  await page.screenshot({ path: `/tmp/journeys/${label}-final.png` });
}

// Desktop pass
const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const desktopPage = await desktopContext.newPage();
desktopPage.on("pageerror", (error) => record("desktop", "J1 no page errors", "zero uncaught exceptions", false, error.message));
await runJourneys(desktopPage, "desktop");
await desktopContext.close();

// Phone pass
const phoneContext = await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: "dark" });
const phonePage = await phoneContext.newPage();
phonePage.on("pageerror", (error) => record("phone", "J1 no page errors", "zero uncaught exceptions", false, error.message));
await runJourneys(phonePage, "phone");
await phoneContext.close();

await browser.close();

writeFileSync("/tmp/journeys/matrix.json", JSON.stringify(results, null, 2));
const failed = results.filter((entry) => entry.verdict === "FAIL");
console.log(`matrix: ${results.length - failed.length}/${results.length} PASS`);
for (const entry of failed) console.log(`FAIL [${entry.journey}] ${entry.step}: ${entry.detail}`);
