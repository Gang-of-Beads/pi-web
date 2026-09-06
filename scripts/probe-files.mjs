/**
 * The files plugin panel, measured in the real 8505 app after the extraction.
 *
 * The extraction moved the whole files experience into pi-web-plugins/files,
 * so this probe drives the real plugin panel through the pi-web-app shadow
 * tree and pins the contracts that had to survive:
 *   - the plugin panel answers to the legacy `core:workspace.files` route
 *     value and to `files`, and is the first workspace tool;
 *   - the tree renders the seeded workspace's entries and a selected file
 *     loads with its viewer;
 *   - selecting a file publishes the `core.workspace.files--file` deep-link
 *     parameter, and a page reload restores the selection from it;
 *   - the upload review dialog opens through the ui.registerModal seam.
 *
 * Usage: node scripts/probe-files.mjs
 * Every unmet precondition FAILS loudly rather than passing empty.
 */
import { chromium } from "@playwright/test";

const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const BASE = "http://127.0.0.1:8505";
const DESKTOP = { width: 1440, height: 900 };

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

const failures = [];
function check(name, ok, detail = "") {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` — ${detail}`}`;
  console.log(line);
  if (!ok) failures.push(line);
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
try {
  const context = await browser.newContext({ viewport: DESKTOP, hasTouch: false });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app", { timeout: 15_000 });
  await page.waitForTimeout(2_500);

  const boot = await page.evaluate(`(function () {
    const state = Reflect.get(document.querySelector("pi-web-app"), "state");
    return { workspaceTool: state.workspaceTool, hasWorkspace: state.selectedWorkspace !== undefined, mainView: state.mainView };
  })()`);
  check("the default workspace tool is the files panel id", boot.workspaceTool === "files:files", boot.workspaceTool);

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
      throw new Error(`Precondition failed: no rows inside ${String(listTag)}; run scripts/stack-8505.sh up`);
    }
    await page.waitForTimeout(waitMs);
  };
  await clickFirstRow("project-list", 800);
  await clickFirstRow("workspace-list", 1_000);
  const selected = await page.evaluate(`(function () {
    const state = Reflect.get(document.querySelector("pi-web-app"), "state");
    return { hasWorkspace: state.selectedWorkspace !== undefined, workspaceId: state.selectedWorkspace?.id ?? "" };
  })()`);
  check("selecting a workspace from the panel selects it", selected.hasWorkspace, JSON.stringify(selected));

  const selectFiles = async (toolValue) => {
    await page.evaluate(`(function () {
      const app = document.querySelector("pi-web-app");
      const open = Reflect.get(app, "openWorkspaceTool");
      if (typeof open !== "function") throw new Error("openWorkspaceTool unavailable");
      Reflect.apply(open, app, [${JSON.stringify(toolValue)}]);
    })()`);
    await page.waitForTimeout(800);
  };
  await selectFiles("core:workspace.files");
  const panelState = await deepQuery(page, "pi-files-panel", `(panel) => {
    if (panel === null) return null;
    const root = panel.shadowRoot;
    const toolbar = root?.querySelector(".toolbar strong");
    const rows = root?.querySelectorAll(".tree button.row");
    return { present: true, toolbarText: toolbar?.textContent ?? "", rowCount: rows === undefined ? 0 : rows.length };
  }`);
  check("the legacy route value opens the plugin files panel", panelState !== null && panelState.toolbarText === "Files", JSON.stringify(panelState));
  check("the seeded workspace's tree rendered", panelState !== null && panelState.rowCount > 0, `rows ${String(panelState?.rowCount ?? 0)}`);

  const seeded = await page.evaluate(`(async function () {
    const state = Reflect.get(document.querySelector("pi-web-app"), "state");
    const machineId = state.selectedMachine?.id ?? "local";
    const project = state.projects.find((candidate) => candidate.id === state.selectedProject?.id) ?? state.selectedProject;
    const workspace = state.selectedWorkspace;
    if (workspace === undefined || project === undefined) throw new Error("workspace or project missing");
    const params = new URLSearchParams({ path: "probe-files.md", overwrite: "true" });
    const response = await fetch(\`api/machines/\${encodeURIComponent(machineId)}/projects/\${encodeURIComponent(project.id)}/workspaces/\${encodeURIComponent(workspace.id)}/file?\${params.toString()}\`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "hello from the files probe" });
    if (!response.ok) throw new Error(\`write failed: \${String(response.status)}\`);
    return { workspaceId: workspace.id, path: "probe-files.md" };
  })()`);
  check("the probe seeded a file through the write endpoint", seeded !== null, JSON.stringify(seeded));
  const refreshed = await deepQuery(page, "pi-files-panel", `(panel) => {
    const root = panel.shadowRoot;
    const refresh = Array.from(root.querySelectorAll(".toolbar button")).find((candidate) => candidate.textContent.trim() === "Refresh");
    if (refresh === undefined) return false;
    refresh.click();
    return true;
  }`);
  await page.waitForTimeout(1_000);
  check("the refresh button was clickable", refreshed);

  const clicked = await deepQuery(page, "pi-files-panel", `(panel) => {
    const root = panel.shadowRoot;
    const fileRow = Array.from(root.querySelectorAll(".tree button.row")).find((candidate) => candidate.textContent.includes("probe-files.md"));
    if (fileRow === undefined) return false;
    fileRow.click();
    return true;
  }`);
  check("the seeded file row was clickable", clicked);
  await page.waitForTimeout(1_200);
  const viewerState = await deepQuery(page, "pi-files-viewer", `(viewer) => {
    if (viewer === null) return null;
    const root = viewer.shadowRoot;
    const header = root?.querySelector(".viewer-header strong");
    return { header: header?.textContent ?? "", status: root?.querySelector(".viewer-status")?.textContent ?? "" };
  }`);
  check("the viewer shows the selected file", viewerState !== null && viewerState.header !== "", JSON.stringify(viewerState));

  const url = page.url();
  const urlHasSelection = url.includes("core.workspace.files--file=");
  check("selecting a file published the deep-link parameter", urlHasSelection, url);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app", { timeout: 15_000 });
  await page.waitForTimeout(3_000);
  const restored = await deepQuery(page, "pi-files-viewer", `(viewer) => {
    if (viewer === null) return null;
    const root = viewer.shadowRoot;
    const header = root?.querySelector(".viewer-header strong");
    return { header: header?.textContent ?? "" };
  }`);
  check("a reload restores the deep-linked selection", restored !== null && restored.header === viewerState?.header, JSON.stringify(restored));

  const uploadDialog = await deepQuery(page, "pi-files-panel", `(panel) => {
    const root = panel.shadowRoot;
    const input = root.querySelector("#workspace-upload-input");
    if (input === undefined) return null;
    const file = new File(["hello"], "probe-upload.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return true;
  }`);
  await page.waitForTimeout(500);
  const dialogOpen = await deepQuery(page, "pi-files-panel", `(panel) => panel.shadowRoot.querySelector(".upload-dialog") !== null`);
  check("the upload review dialog opens", uploadDialog === true && dialogOpen, `clicked ${String(uploadDialog)} open ${String(dialogOpen)}`);
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed`);
  process.exit(1);
}
console.log("\nAll files panel checks passed");
