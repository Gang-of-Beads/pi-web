#!/usr/bin/env node
/**
 * Live check at 393x850: the git panel's "New worktree" creates a linked
 * worktree through the provider and, after the host re-reads its catalog,
 * the checkout is listed as a workspace - without switching to it.
 * Preconditions fail loudly; the throwaway repository lives under the 8505
 * data directory and is recreated on every run.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const ROOT = `${process.env.HOME}/.pi-web-8505/pi-web-8505-worktree-probe`;
const REPO = join(ROOT, "repo");
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }
const git = (cwd, args) => execFileSync("git", ["-c", "user.name=Probe", "-c", "user.email=probe@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(REPO, { recursive: true });
git(REPO, ["init", "-b", "main"]);
writeFileSync(join(REPO, "README.md"), "# probe\n");
git(REPO, ["add", "-A"]);
git(REPO, ["commit", "-m", "init"]);
const registered = await fetch(`${BASE}/api/machines/local/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: REPO }) });
if (!registered.ok) fail(`project registration answered ${String(registered.status)}`);
const branch = `probe-${String(Date.now()).slice(-6)}`;
const expectedPath = join(ROOT, `repo-${branch}`);

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true })).newPage();
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app");
  await page.waitForTimeout(3000);
  const opened = await page.evaluate(`(async function(){
    const app = document.querySelector("pi-web-app");
    const project = Reflect.get(app, "state").projects.find((p) => p.path === ${JSON.stringify(REPO)});
    if (!project) return { error: "probe repo is not a project" };
    await Reflect.get(app, "workspaces").selectProject(project);
    await new Promise((r) => setTimeout(r, 2500));
    const before = Reflect.get(app, "state").workspaces.map((w) => w.path);
    const open = Reflect.get(app, "openWorkspaceTool");
    open.call(app, "git:workspace.git");
    await new Promise((r) => setTimeout(r, 2500));
    const panel = app.shadowRoot.querySelector("workspace-panel");
    const fold = panel?.shadowRoot?.querySelector(".workspace-tool-fold");
    if (!fold) return { error: "the tool header has no fold button" };
    if (fold.getAttribute("aria-expanded") !== "true") { fold.click(); await new Promise((r) => setTimeout(r, 400)); }
    const roots = [panel?.shadowRoot];
    const seen = new Set();
    let button;
    while (roots.length > 0 && !button) {
      const root = roots.shift();
      if (!root || seen.has(root)) continue;
      seen.add(root);
      button = [...root.querySelectorAll("button.git-new-worktree")][0];
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    if (!button) return { error: "no New worktree button in the git panel" };
    const rect = button.getBoundingClientRect();
    if (rect.right > window.innerWidth || rect.height < 32) return { error: "button off the phone or below the control height: right " + String(Math.round(rect.right)) + ", height " + String(Math.round(rect.height)) };
    button.click();
    await new Promise((r) => setTimeout(r, 800));
    const dialog = document.querySelector("pi-web-git-worktree-dialog") ?? app.shadowRoot.querySelector("pi-web-git-worktree-dialog");
    if (!dialog) return { error: "dialog did not open" };
    const branchInput = dialog.shadowRoot.querySelector("input[name=branch]");
    branchInput.value = ${JSON.stringify(branch)};
    branchInput.dispatchEvent(new Event("input"));
    const suggested = dialog.shadowRoot.querySelector("input[name=path]").value;
    dialog.shadowRoot.querySelector("form").dispatchEvent(new Event("submit", { cancelable: true }));
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const still = document.querySelector("pi-web-git-worktree-dialog") ?? app.shadowRoot.querySelector("pi-web-git-worktree-dialog");
      const error = still?.shadowRoot?.querySelector(".error:not([hidden])")?.textContent;
      if (error) return { error: "dialog reported: " + error };
      const state = Reflect.get(app, "state");
      const after = state.workspaces.map((w) => w.path);
      if (!still && after.includes(${JSON.stringify(expectedPath)})) return { before, after, suggested, buttonHeight: Math.round(rect.height), selected: state.selectedWorkspace?.path };
    }
    return { error: "worktree did not appear in the workspace list within 20s", after: Reflect.get(app, "state").workspaces.map((w) => w.path) };
  })()`);
  if (opened.error) fail(opened.error + (opened.after ? " " + JSON.stringify(opened.after) : ""));
  console.log(JSON.stringify(opened));
  if (opened.suggested !== expectedPath) fail(`suggested path ${opened.suggested} != ${expectedPath}`);
  if (opened.before.includes(expectedPath)) fail("worktree existed before the dialog");
  if (opened.selected === expectedPath) fail("the app switched to the new worktree; the owner ruled create-only");
  if (!existsSync(join(expectedPath, "README.md"))) fail("worktree directory is not a checkout on disk");
  if (!git(REPO, ["worktree", "list", "--porcelain"]).includes(`branch refs/heads/${branch}`)) fail("git does not list the new worktree");
  await page.screenshot({ path: "/tmp/journeys/worktree-added.png" });
  console.log(`PASS: New worktree created ${expectedPath} on ${branch}; listed as a workspace, selection unchanged`);
} finally {
  await browser.close();
}
