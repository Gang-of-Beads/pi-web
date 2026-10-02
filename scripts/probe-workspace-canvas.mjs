import { chromium } from "@playwright/test";

/**
 * A workspace page on the whole canvas, on the 8505 stack (no-row review `4d54a383`, canvas review
 * `671724cc`). Git declares the canvas and draws its own way in and out; no page that did not declare
 * it, and no page the window or a folded panel cannot show, may hide the app bar.
 */

const BASE = "http://127.0.0.1:8505";
const ROUTE = "project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac&session=01a05000-5eed-7c00-8000-0000000000e1";
const OUT = "/tmp/surfaces/canvas";
const results = [];
const record = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};
const link = (tool, expanded) => `${BASE}/?${ROUTE}&tool=${encodeURIComponent(tool)}&view=${encodeURIComponent(tool)}${expanded ? "&core.workspace--expanded=1" : ""}`;

const look = (page) => page.evaluate(() => {
  const app = document.querySelector("pi-web-app");
  const shell = app?.shadowRoot?.querySelector(".shell");
  const panel = app?.shadowRoot?.querySelector("#workspace-panel");
  const root = panel?.shadowRoot;
  const main = app?.shadowRoot?.querySelector(".shell > main");
  const end = root?.querySelector(".git-toolbar-end");
  return {
    tool: app?.state?.workspaceTool ?? null,
    canvas: shell?.classList.contains("workspace-panel-fullscreen") ?? null,
    appBarShown: main !== null && main !== undefined && getComputedStyle(main).display !== "none",
    toolbar: root?.querySelector(".workspace-tool-toolbar") !== null && root?.querySelector(".workspace-tool-toolbar") !== undefined,
    status: end?.querySelector(".git-toolbar-status")?.textContent.trim() ?? null,
    keys: [...(end?.querySelectorAll("button") ?? [])].map((key) => key.textContent.trim()),
    filesStatus: root?.querySelector(".files-toolbar-status")?.textContent.trim() ?? null,
    expanded: new URL(window.location.href).searchParams.get("core.workspace--expanded"),
  };
});

const clickKey = (page, label) => page.evaluate((text) => {
  const root = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("#workspace-panel")?.shadowRoot;
  const key = [...(root?.querySelectorAll(".git-toolbar-end button") ?? [])].find((button) => button.textContent.trim() === text);
  key?.click();
  return key !== undefined;
}, label);

async function open(browser, viewport, url, options = {}) {
  const phone = viewport === "phone";
  const context = await browser.newContext(phone
    ? { viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
    : { viewport: { width: 1440, height: 900 } });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  if (options.foldedPanel === true) await page.addInitScript(() => { window.localStorage.setItem("pi-web-app-panel-collapse", JSON.stringify({ workspacePanelCollapsed: true })); });
  await page.goto(url);
  await page.waitForTimeout(5000);
  return { context, page };
}

const browser = await chromium.launch();
try {
  {
    const { context, page } = await open(browser, "desktop", link("git:workspace.git", false));
    const before = await look(page);
    record("precondition: desktop Git page with its toolbar", before.tool === "git:workspace.git" && before.toolbar && before.status !== null, JSON.stringify(before));
    record("desktop Git: branch status and Expand at the end of its own toolbar", before.status?.startsWith("main") === true && before.keys.join() === "Expand" && before.canvas === false, JSON.stringify(before));
    await page.screenshot({ path: `${OUT}/1-desktop-git.png` });
    const clicked = await clickKey(page, "Expand");
    await page.waitForTimeout(800);
    const held = await look(page);
    record("Expand puts Git on the whole canvas, with its own exit", clicked && held.canvas === true && !held.appBarShown && held.keys.join() === "Exit expanded" && held.expanded === "1", JSON.stringify(held));
    await page.screenshot({ path: `${OUT}/2-desktop-git-canvas.png` });
    const left = await clickKey(page, "Exit expanded");
    await page.waitForTimeout(800);
    const back = await look(page);
    record("Exit expanded gives the canvas back", left && back.canvas === false && back.appBarShown && back.expanded === null && back.keys.join() === "Expand", JSON.stringify(back));
    await context.close();
  }
  {
    const { context, page } = await open(browser, "desktop", link("files:files", true));
    const seen = await look(page);
    record("precondition: an old link names Files with expanded=1", seen.tool === "files:files", JSON.stringify(seen));
    record("Files, which did not declare the canvas, is not stranded by the old link", seen.canvas === false && seen.appBarShown, JSON.stringify(seen));
    await page.screenshot({ path: `${OUT}/3-desktop-files-old-link.png` });
    await context.close();
  }
  {
    const { context, page } = await open(browser, "desktop", link("git:workspace.git", true));
    const seen = await look(page);
    record("a link to Git expanded opens on the canvas with its exit on screen", seen.tool === "git:workspace.git" && seen.canvas === true && seen.keys.join() === "Exit expanded", JSON.stringify(seen));
    await context.close();
  }
  {
    const { context, page } = await open(browser, "desktop", link("git:workspace.git", true), { foldedPanel: true });
    const seen = await look(page);
    const folded = await page.evaluate(() => document.querySelector("pi-web-app")?.shadowRoot?.querySelector(".shell")?.classList.contains("workspace-panel-collapsed") ?? null);
    record("precondition: the workspace panel is folded away when a Git expanded link opens", folded === true && seen.tool === "git:workspace.git", JSON.stringify({ folded, tool: seen.tool }));
    record("a folded panel never leaves an empty window: the app bar stays", seen.canvas === false && seen.appBarShown, JSON.stringify(seen));
    await page.screenshot({ path: `${OUT}/6-desktop-folded-expanded-link.png` });
    await context.close();
  }
  {
    const { context, page } = await open(browser, "phone", link("git:workspace.git", true));
    const seen = await look(page);
    record("precondition: phone opens a Git expanded link", seen.tool === "git:workspace.git" && seen.toolbar, JSON.stringify(seen));
    record("phone Git from an expanded link: no canvas it cannot show, so no exit key for one", seen.canvas === false && seen.keys.length === 0, JSON.stringify(seen));
    await context.close();
  }
  {
    const { context, page } = await open(browser, "phone", link("git:workspace.git", false));
    const seen = await look(page);
    record("precondition: phone Git page", seen.tool === "git:workspace.git" && seen.toolbar, JSON.stringify(seen));
    record("phone Git: status shown, no Expand where the canvas cannot show", seen.status?.startsWith("main") === true && seen.keys.length === 0, JSON.stringify(seen));
    await page.screenshot({ path: `${OUT}/4-phone-git.png` });
    await context.close();
  }
  {
    const { context, page } = await open(browser, "phone", link("files:files", false));
    const seen = await look(page);
    record("control: phone Files shows its toolbar and no out of date mark on a fresh tree", seen.tool === "files:files" && seen.toolbar && seen.filesStatus === null, JSON.stringify(seen));
    await page.screenshot({ path: `${OUT}/5-phone-files.png` });
    await context.close();
  }
} finally {
  await browser.close();
}
const passed = results.filter(Boolean).length;
console.log(`${String(passed)}/${String(results.length)} passed`);
process.exitCode = passed === results.length ? 0 : 1;
