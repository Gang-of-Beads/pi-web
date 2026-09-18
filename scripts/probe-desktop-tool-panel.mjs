import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_URL ?? "http://127.0.0.1:8505";

function deepQuery(root, selector) {
  const found = root.querySelector(selector);
  if (found !== null) return found;
  for (const element of root.querySelectorAll("*")) {
    if (element.shadowRoot === null) continue;
    const inner = deepQuery(element.shadowRoot, selector);
    if (inner !== null) return inner;
  }
  return null;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(`window.__deepQuery = ${deepQuery.toString()};`);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

const fresh = await page.evaluate(() => {
  const app = document.querySelector("pi-web-app");
  const root = app?.shadowRoot;
  const hasWorkspace = Reflect.get(app, "state")?.selectedWorkspace !== undefined;
  const control = root?.querySelector('app-panel-edge-control[side="workspace"]');
  const button = control?.shadowRoot?.querySelector(".edge-button");
  const before = Math.round(button?.getBoundingClientRect().width ?? 0);
  button?.click();
  return new Promise((resolve) => setTimeout(() => {
    resolve({
      hasWorkspace,
      handleWidth: before,
      panelWidth: Math.round(root?.querySelector("workspace-panel")?.getBoundingClientRect().width ?? 0),
      panelText: (root?.querySelector("workspace-panel")?.shadowRoot?.textContent ?? "").trim().slice(0, 60),
    });
  }, 700));
});
console.log(JSON.stringify({ fresh }, null, 2));
if (fresh.hasWorkspace) { console.log("FAIL: this leg needs a boot with no workspace selected"); process.exit(1); }
if (fresh.handleWidth < 20) { console.log(`FAIL: the handle is a ${String(fresh.handleWidth)}px sliver before anything is chosen`); process.exit(1); }
if (fresh.panelWidth < 200) { console.log(`FAIL: pressing the handle with no workspace left the panel off screen (${String(fresh.panelWidth)}px)`); process.exit(1); }

await page.evaluate(`(async function(){
  function deepAll(root, selector) {
    const out = []; const queue = [root]; const seen = new Set();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      for (const el of current.querySelectorAll(selector)) out.push(el);
      for (const el of current.querySelectorAll("*")) if (el.shadowRoot) queue.push(el.shadowRoot);
    }
    return out;
  }
  const root = document.querySelector("pi-web-app").shadowRoot;
  const projectsKind = deepAll(root, "button.kind").find((b) => b.textContent.trim() === "Projects");
  projectsKind?.click();
  await new Promise((r) => setTimeout(r, 800));
  const project = deepAll(root, "button.row.project, button.row")[0];
  project?.click();
  await new Promise((r) => setTimeout(r, 2000));
  const session = deepAll(root, "button.row.session")[0];
  session?.click();
  await new Promise((r) => setTimeout(r, 2500));
})()`);
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const root = document.querySelector("pi-web-app")?.shadowRoot;
  const rows = [];
  const walk = (node) => {
    for (const element of node.querySelectorAll("button")) rows.push(element.className + "|" + (element.textContent ?? "").trim().slice(0, 40));
    for (const element of node.querySelectorAll("*")) if (element.shadowRoot !== null) walk(element.shadowRoot);
  };
  walk(root);
  Reflect.set(window, "__rows", rows);
});
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const root = document.querySelector("pi-web-app")?.shadowRoot;
  const row = root === undefined || root === null ? null : window.__deepQuery(root, "button.row.session");
  row?.click();
});
await page.waitForTimeout(3000);

const state = await page.evaluate(() => {
  const app = document.querySelector("pi-web-app");
  const root = app?.shadowRoot;
  if (root === undefined || root === null) return { error: "no app shadow root" };
  const shell = root.querySelector(".shell");
  const panel = root.querySelector("workspace-panel");
  const edge = [...root.querySelectorAll("app-panel-edge-control")].map((element) => {
    const button = element.shadowRoot?.querySelector(".edge-button");
    const buttonRect = button?.getBoundingClientRect();
    const style = button === null || button === undefined ? null : getComputedStyle(button);
    return {
      side: element.getAttribute("side"),
      hostWidth: element.getBoundingClientRect().width,
      button: buttonRect === undefined ? null : { width: Math.round(buttonRect.width), height: Math.round(buttonRect.height), x: Math.round(buttonRect.x) },
      opacity: style?.opacity ?? null,
      color: style?.color ?? null,
      background: style?.backgroundColor ?? null,
    };
  });
  const rect = panel?.getBoundingClientRect();
  return {
    shellClass: shell?.className ?? null,
    gridColumns: shell === null ? null : getComputedStyle(shell).gridTemplateColumns,
    panelPresent: panel !== null,
    panelDisplay: panel === null ? null : getComputedStyle(panel).display,
    panelRect: rect === undefined ? null : { width: rect.width, height: rect.height, x: rect.x },
    edge,
    selectedSession: Reflect.get(app, "state")?.selectedSession?.id ?? null,
    selectedWorkspace: Reflect.get(app, "state")?.selectedWorkspace?.path ?? null,
    workspaceCount: Reflect.get(app, "state")?.workspaces?.length ?? null,
    rows: Reflect.get(window, "__rows")?.slice(0, 30) ?? null,
  };
});

const collapsed = await page.evaluate(() => {
  const root = document.querySelector("pi-web-app")?.shadowRoot;
  const app = document.querySelector("pi-web-app");
  Reflect.get(app, "panelCollapse").toggleWorkspacePanel();
  return new Promise((resolve) => setTimeout(() => {
    const control = root?.querySelector('app-panel-edge-control[side="workspace"]');
    const button = control?.shadowRoot?.querySelector(".edge-button");
    const rect = button?.getBoundingClientRect();
    const style = button === null || button === undefined ? null : getComputedStyle(button);
    resolve({
      width: rect === undefined ? 0 : Math.round(rect.width),
      height: rect === undefined ? 0 : Math.round(rect.height),
      opacity: style === null ? "0" : style.opacity,
      border: style === null ? "" : style.borderTopColor,
      panelWidth: Math.round(root?.querySelector("workspace-panel")?.getBoundingClientRect().width ?? 0),
    });
  }, 600));
});

await page.screenshot({ path: "/tmp/journeys/desktop-tool-panel.png" });
await browser.close();

console.log(JSON.stringify(state, null, 2));
if (state.error !== undefined) { console.log("FAIL: " + state.error); process.exit(1); }
if (!state.panelPresent) { console.log("FAIL: no workspace-panel element in the shell"); process.exit(1); }
if (state.panelRect === null || state.panelRect.width < 200) {
  console.log(`FAIL: the tool panel has no desktop column (width ${String(state.panelRect?.width)}, shell "${String(state.shellClass)}")`);
  process.exit(1);
}
console.log(JSON.stringify({ collapsed }, null, 2));
if (collapsed.panelWidth !== 0) { console.log("FAIL: collapsing left the panel on screen, so this leg proves nothing"); process.exit(1); }
if (collapsed.width < 20 || collapsed.opacity !== "1") {
  console.log(`FAIL: the only way back to the collapsed panel paints as a ${String(collapsed.width)}px sliver at opacity ${collapsed.opacity}`);
  process.exit(1);
}
console.log("PASS: the tool panel holds a desktop column, and its collapsed handle is a visible control");
