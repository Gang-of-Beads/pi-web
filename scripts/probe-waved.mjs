import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:8505";
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: EXE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);

  const body = await page.evaluate(() => document.body.innerText);

  // 1. No notifications/activity drawer chrome anywhere on boot.
  check("no notifications drawer chrome", !/Notifications/i.test(body), body.includes("Notifications") ? "found 'Notifications'" : "");
  const tabs = await page.evaluate(() => [...document.querySelectorAll("[role=tab] .drawer-tab-label, .drawer-tab-label")].map((n) => n.textContent.trim()));
  check("no built-in Activity tab", !tabs.some((t) => t.startsWith("Activity")), tabs.join("|") || "no tabs rendered");

  // 2. Goals plugin contributes a section on 8505 (goals plugin bundled): its tab may exist.
  //    If the drawer exists at all it must be because a section was contributed.
  const drawerToggle = await page.$(".drawer-toggle");
  if (drawerToggle !== null) {
    check("drawer toggle has honest label", await drawerToggle.getAttribute("aria-label") === "Show session sections" || await drawerToggle.getAttribute("aria-label") === "Hide session sections", await drawerToggle.getAttribute("aria-label"));
    const tabLabels = await page.evaluate(() => [...document.querySelectorAll(".drawer-tab-label")].map((n) => n.textContent.trim()));
    check("every drawer tab is a contributed section (no bare Activity/Notifications)", tabLabels.every((t) => !/^(Activity|Notifications)/.test(t)), tabLabels.join("|"));
  } else {
    check("drawer absent when no sections contributed", true, "no drawer toggle rendered");
  }

  // 3. Background dock pill exists as a non-interactive element on idle boot? On a fresh
  //    boot with no work it should be absent; with work it is a div, not a button.
  const dockButtons = await page.evaluate(() => [...document.querySelectorAll("button.activity-dock.background")].length);
  check("background dock is not a button (silent pill)", dockButtons === 0, `button.docks=${dockButtons}`);
  const dockDivs = await page.evaluate(() => document.querySelectorAll(".activity-dock.background").length);
  check("dock pill is a div when rendered", await page.evaluate(() => [...document.querySelectorAll(".activity-dock.background")].every((n) => n.tagName === "DIV")), `div.docks=${dockDivs}`);

  // 4. Drill into a project (the phone flow opens the session's chat), then
  //    the composer must be reachable.
  await page.evaluate(`(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&kids[i].tagName==="PROJECT-LIST")found=kids[i];}};visit(document);if(!found)return;var el=found.shadowRoot.querySelector("button.action-main");if(el)el.click();})()`);
  await page.waitForTimeout(2200);
  await page.evaluate(`(function(){var found=null;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].shadowRoot&&!found)visit(kids[i].shadowRoot);if(kids[i].shadowRoot&&kids[i].tagName==="SESSION-LIST")found=kids[i];}};visit(document);if(!found)return;var el=found.shadowRoot.querySelector(".action-row .action-main");if(el)el.click();})()`);
  await page.waitForTimeout(2500);
  const composer = await page.evaluate(`(function(){var n=0;var visit=function(root){var kids=root.querySelectorAll("*");for(var i=0;i<kids.length;i++){if(kids[i].tagName==="PROMPT-EDITOR")n++;if(kids[i].shadowRoot)visit(kids[i].shadowRoot);}};visit(document);return n;})()`);
  check("composer present once a chat is open", composer > 0, `prompt-editors=${String(composer)}`);
  // Desktop pass: same assertions at a desktop viewport.
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await desktop.goto(BASE, { waitUntil: "domcontentloaded" });
  await desktop.waitForTimeout(2200);
  const dtabs = await desktop.evaluate(() => [...document.querySelectorAll(".drawer-tab-label")].map((n) => n.textContent.trim()));
  check("desktop: no built-in Activity/Notifications tabs", dtabs.every((t) => !/^(Activity|Notifications)/.test(t)), dtabs.join("|") || "no tabs");

  await page.screenshot({ path: "/tmp/waved-phone.png", fullPage: false });
  await desktop.screenshot({ path: "/tmp/waved-desktop.png", fullPage: false });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
