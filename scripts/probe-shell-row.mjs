/**
 * Minimal shell row + unified panel (bars-minimalism-design), measured in the
 * real 8505 app at a phone viewport with a coarse pointer.
 *
 * The owner's report was about the screen: two bars, too much in them, content
 * cut off by a horizontal chip scroller. This probe drives the real shell
 * through the pi-web-app shadow tree:
 *   - the resident row holds only the approved controls and nothing overflows
 *     horizontally at 393px;
 *   - every row control meets the 44px touch floor;
 *   - selecting a session from the panel opens the chat, the resident row
 *     names it, and the bottom status bar renders for it (owner kept the bar);
 *   - the toggle reopens the panel whose compact header carries Settings and
 *     Actions, and whose tools section lists the workspace views (B1/B2/B4).
 *
 * Usage: node scripts/probe-shell-row.mjs
 * Every unmet precondition FAILS loudly rather than passing empty.
 */
import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = "http://127.0.0.1:8505";
const PHONE = { width: 393, height: 850 };

/** Deep-walk the pi-web-app shadow tree; the only way in from page.evaluate. */
function deepQuery(page, selector, body) {
  const expression = `(function () {
    const walk = (root) => {
      for (const node of root.querySelectorAll("*")) {
        if (node.matches(${JSON.stringify(selector)})) return node;
        if (node.shadowRoot) { const hit = walk(node.shadowRoot); if (hit !== null) return hit; }
      }
      return null;
    };
    const found = walk(document);
    return (${body})(found);
  })()`;
  return page.evaluate(expression);
}

function deepExists(page, selector) {
  const expression = `(function () {
    const has = (root) => {
      for (const node of root.querySelectorAll("*")) {
        if (node.matches(${JSON.stringify(selector)})) return true;
        if (node.shadowRoot && has(node.shadowRoot)) return true;
      }
      return false;
    };
    return has(document);
  })()`;
  return page.evaluate(expression);
}

const failures = [];
const skipped = [];
function check(name, ok, detail = "") {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` — ${detail}`}`;
  console.log(line);
  if (!ok) failures.push(line);
}
function skip(name, detail) {
  console.log(`SKIP ${name} — ${detail}`);
  skipped.push(name);
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
try {
  const context = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app", { timeout: 15_000 });
  await page.waitForTimeout(2_500);

  const rowState = await deepQuery(page, "app-context-bar", `(bar) => {
    if (bar === null) throw new Error("app-context-bar not found in the shadow tree");
    const root = bar.shadowRoot;
    if (root === null) throw new Error("app-context-bar shadow root missing");
    const row = root.querySelector(".context-bar");
    const box = (node) => {
      if (node === null) return null;
      const rect = node.getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height) };
    };
    return {
      classes: Array.from(root.querySelectorAll(".context-bar > *")).map((node) => node.className.split(" ")[0]),
      scrollDelta: row === null ? -1 : row.scrollWidth - row.clientWidth,
      toggle: box(root.querySelector(".panel-toggle")),
      title: box(root.querySelector(".session-title")),
    };
  }`);

  const allowed = new Set(["panel-toggle", "session-title", "working"]);
  const unknown = rowState.classes.filter((name) => !allowed.has(name));
  check("resident row holds only approved controls", unknown.length === 0 && rowState.classes.length >= 2, rowState.classes.join(" | "));
  check("row has no horizontal overflow at 393px", rowState.scrollDelta <= 0, `scroll delta ${String(rowState.scrollDelta)}`);
  check("panel toggle meets the 44px floor", rowState.toggle !== null && rowState.toggle.w >= 44 && rowState.toggle.h >= 44, rowState.toggle === null ? "missing" : `${String(rowState.toggle.w)}x${String(rowState.toggle.h)}`);
  check("session slot meets the 44px floor", rowState.title !== null && rowState.title.h >= 44, rowState.title === null ? "missing" : `${String(rowState.title.w)}x${String(rowState.title.h)}`);

  const shellState = await page.evaluate(`(function () {
    const app = document.querySelector("pi-web-app");
    const state = Reflect.get(app, "state");
    return { mainView: state.mainView, hasSession: state.selectedSession !== undefined, hasWorkspace: state.selectedWorkspace !== undefined };
  })()`);
  check("phone boots into the panel by design", shellState.mainView === "navigation", `mainView ${shellState.mainView}`);

  const clickFirstRow = async (listTag, waitMs) => {
    const clicked = await deepQuery(page, listTag, `(list) => {
      if (list === null) throw new Error(${JSON.stringify("${listTag} missing from the open panel")});
      const root = list.shadowRoot;
      if (root === null) throw new Error(${JSON.stringify("${listTag} shadow root missing")});
      const row = root.querySelector("button.action-main");
      if (row === null) return false;
      row.click();
      return true;
    }`);
    if (!clicked) {
      throw new Error(`Precondition failed: no rows inside ${String(listTag)}; run scripts/stack-8505.sh seed`);
    }
    await page.waitForTimeout(waitMs);
  };
  await clickFirstRow("project-list", 800);
  await clickFirstRow("workspace-list", 800);
  await clickFirstRow("session-list", 1_200);
  const selected = await page.evaluate(`(function () {
    const state = Reflect.get(document.querySelector("pi-web-app"), "state");
    return { hasSession: state.selectedSession !== undefined, hasWorkspace: state.selectedWorkspace !== undefined, mainView: state.mainView };
  })()`);
  check("selecting a session from the panel opens the chat", selected.hasSession && selected.mainView === "chat", JSON.stringify(selected));

  const statusBarOpen = await deepExists(page, "status-bar");
  check("bottom status bar renders for the selected session", statusBarOpen);

  const rowTitle = await deepQuery(page, "app-context-bar", `(bar) => {
    const root = bar.shadowRoot;
    if (root === null) throw new Error("app-context-bar shadow root missing");
    return root.querySelector(".session-title")?.textContent ?? "";
  }`);
  check("resident row names the selected session", rowTitle !== "" && rowTitle !== "Sessions", JSON.stringify(rowTitle));

  await page.locator("app-context-bar").locator(".panel-toggle").click();
  await page.waitForTimeout(700);
  const panelState = await deepQuery(page, "app-navigation-panel", `(panel) => {
    if (panel === null) throw new Error("app-navigation-panel missing while the panel is open");
    const root = panel.shadowRoot;
    if (root === null) throw new Error("app-navigation-panel shadow root missing");
    const rect = panel.getBoundingClientRect();
    const header = Array.from(root.querySelectorAll(".compact-header-action")).map((node) => node.getAttribute("aria-label") ?? "");
    const tools = root.querySelectorAll(".tools-section .tool-row").length;
    return { open: rect.width > 0 && rect.height > 0, header: header.join("|"), tools };
  }`);
  check("toggle reopens the panel over the chat", panelState.open);
  check("panel header carries Settings and Actions (B2)", panelState.header.includes("Open settings") && panelState.header.includes("Show Actions"), panelState.header || "(no header actions)");
  check("panel renders a tools section (B4)", panelState.tools > 0, `tool rows ${String(panelState.tools)}`);
  await page.screenshot({ path: "/tmp/shell-row-panel-phone.png" });

  await page.goBack();
  await page.waitForTimeout(500);
  const panelClosed = await page.evaluate(`(function () {
    const app = document.querySelector("pi-web-app");
    return Reflect.get(app, "state").mainView !== "navigation";
  })()`);
  check("back gesture closes the panel (popstate contract)", panelClosed);

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await desktopPage.waitForSelector("pi-web-app", { timeout: 15_000 });
  await desktopPage.waitForTimeout(2_500);
  const desktopState = await deepQuery(desktopPage, "app-context-bar", `(bar) => {
    if (bar === null) throw new Error("app-context-bar missing on desktop");
    const root = bar.shadowRoot;
    if (root === null) throw new Error("app-context-bar shadow root missing");
    const title = root.querySelector(".session-title");
    if (title === null) throw new Error("session title missing on desktop");
    title.click();
    return true;
  }`);
  await desktopPage.waitForTimeout(700);
  const switcherOpen = await deepExists(desktopPage, "quick-switcher");
  check("desktop has a pointer path to the quick switcher (B1)", desktopState === true && switcherOpen, `clicked=${String(desktopState)} switcher=${String(switcherOpen)}`);
  await desktopPage.screenshot({ path: "/tmp/shell-row-desktop.png" });
  await desktop.close();

  await context.close();
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.log(`\n${String(failures.length)} check(s) failed`);
  process.exit(1);
}
console.log(`\nAll shell-row checks passed${skipped.length > 0 ? ` (${String(skipped.length)} skipped for missing preconditions)` : ""}`);
