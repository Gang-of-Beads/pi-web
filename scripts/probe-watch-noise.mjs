import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

/**
 * The workspace watcher publishes real changes only (object model §1.16).
 *
 * 8504 on 2026-09-30: git status and tree reads were 74 % of all requests, with
 * the daemon at 99 % CPU. The watcher published on any write under a workspace,
 * including git's objects and lock files, node_modules and pi's task logs.
 * After the owner's requested research (VS Code's git extension, GitLens) it
 * keeps a `.git` whitelist, drops that noise, coalesces the tree for 2.5 s, and
 * a hidden tab refreshes nothing until it is shown.
 *
 * On 8505, with the Git panel open on a git workspace and a session there
 * (so the daemon watches it):
 * - noise: 15 s of writes to `.git/objects`, `.git/index.lock`, `node_modules`
 *   and `.pi/tasks` must publish no `workspace.changed` (counted on the daemon's
 *   socket: the Git panel also polls every 8 s, so HTTP reads cannot tell);
 * - signal: a linked worktree's git state, which lives under the main
 *   repository's `.git/worktrees/`, publishes within 1.5 s;
 * - signal: a file written outside PI WEB shows within 3.5 s (the 2.5 s tree
 *   window), and committing it clears it within 1.5 s (the 250 ms git window).
 */
const BASE = process.env.PI_WEB_PROBE_BASE ?? process.env.PROBE_BASE ?? "http://127.0.0.1:8505";
const REPO = join(homedir(), ".pi-web-8505", "pi-web-8505-worktree-probe", "repo");
const PROJECT = "f4ad2c1e-58eb-4a30-abd9-0f87eff30022";
const WORKSPACE = "61beb7f600dd";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const git = (args) => execFileSync("git", ["-c", "user.name=Probe", "-c", "user.email=probe@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: REPO, encoding: "utf8" });

const results = [];
function leg(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` - ${detail}`}`);
}

const api = (path, init) => fetch(`${BASE}/api/${path}`, { headers: { "content-type": "application/json" }, ...init }).then((response) => response.json());
const created = await api("sessions", { method: "POST", body: JSON.stringify({ cwd: REPO }) });
if (typeof created.id !== "string") throw new Error(`no session: ${JSON.stringify(created)}`);
await api(`sessions/${created.id}/status?cwd=${encodeURIComponent(REPO)}`);
const startingCommit = git(["rev-parse", "HEAD"]).trim();
let events;

const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const reads = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/\/plugin-backends\/git\/projects\/[^/]+\/workspaces\/[^/]+\/status/u.test(url) || /\/workspaces\/[^/]+\/tree/u.test(url)) reads.push(Date.now());
  });
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=${WORKSPACE}&session=${created.id}&view=git:workspace.git`, { waitUntil: "domcontentloaded" });
  await sleep(6000);
  const settled = reads.length;
  leg("precondition: the Git panel read the workspace", settled > 0, `${String(settled)} reads at open`);
  const visibility = await page.evaluate(() => document.visibilityState);
  leg("precondition: the page is visible, so it refreshes at once", visibility === "visible", visibility);

  mkdirSync(join(REPO, "node_modules", "noise"), { recursive: true });
  mkdirSync(join(REPO, ".pi", "tasks"), { recursive: true });
  mkdirSync(join(REPO, ".git", "objects", "zz"), { recursive: true });
  await sleep(4000);
  const published = [];
  events = new WebSocket(`${BASE.replace(/^http/u, "ws")}/api/machines/local/events`);
  events.addEventListener("message", async (event) => {
    const raw = typeof event.data === "string" ? event.data : await event.data.text();
    const frame = JSON.parse(raw);
    if (frame.type === "workspace.changed" && frame.cwd === REPO) published.push(Date.now());
  });
  await new Promise((resolve) => { events.addEventListener("open", resolve, { once: true }); });
  writeFileSync(join(REPO, "probe-watch-live.txt"), "live\n");
  await sleep(3500);
  execFileSync("rm", ["-f", join(REPO, "probe-watch-live.txt")]);
  leg("precondition: the daemon watches the workspace (a tree write publishes within 3.5 s)", published.length > 0, `${String(published.length)} frames`);
  await sleep(3000);
  published.length = 0;
  for (let tick = 0; tick < 30; tick += 1) {
    writeFileSync(join(REPO, ".git", "objects", "zz", `noise-${String(tick)}`), "x");
    writeFileSync(join(REPO, ".git", "index.lock"), "x");
    writeFileSync(join(REPO, "node_modules", "noise", "index.js"), String(tick));
    appendFileSync(join(REPO, ".pi", "tasks", "noise.output"), `line ${String(tick)}\n`);
    await sleep(500);
  }
  execFileSync("rm", ["-f", join(REPO, ".git", "index.lock")]);
  await sleep(3000);
  leg("noise: 15 s of git churn, node_modules and task logs publish no workspace change", published.length === 0, `${String(published.length)} workspace.changed frames`);

  const panelText = () => page.evaluate(() => {
    const deepText = (node) => [...node.childNodes].map((child) => (child.nodeType === Node.TEXT_NODE ? child.textContent : deepText(child))).join(" ") + (node.shadowRoot ? deepText(node.shadowRoot) : "");
    return deepText(document.body);
  });
  const waitFor = async (predicate, limitMs) => {
    const started = Date.now();
    while (Date.now() - started < limitMs) {
      if (predicate(await panelText())) return Date.now() - started;
      await sleep(100);
    }
    return undefined;
  };
  const file = `probe-signal-${String(Date.now())}.txt`;
  writeFileSync(join(REPO, file), "signal\n");
  const listedAfter = await waitFor((text) => text.includes(file), 8000);
  leg("signal: a file written outside PI WEB shows in the Git panel within 3.5 s", listedAfter !== undefined && listedAfter <= 3500, `shown after ${String(listedAfter)} ms`);
  git(["add", file]);
  git(["commit", "-q", "-m", `probe ${file}`]);
  const clearedAfter = await waitFor((text) => !text.includes(file), 8000);
  leg("signal: committing it outside PI WEB clears it from the panel within 1.5 s", clearedAfter !== undefined && clearedAfter <= 1500, `cleared after ${String(clearedAfter)} ms`);
  const worktree = join(homedir(), ".pi-web-8505", "pi-web-8505-worktree-probe", "repo-probe-672483");
  const worktreeSession = await api("sessions", { method: "POST", body: JSON.stringify({ cwd: worktree }) });
  await api(`sessions/${worktreeSession.id}/status?cwd=${encodeURIComponent(worktree)}`);
  await sleep(1500);
  const worktreeFrames = [];
  const worktreeEvents = new WebSocket(`${BASE.replace(/^http/u, "ws")}/api/machines/local/events`);
  worktreeEvents.addEventListener("message", async (event) => {
    const raw = typeof event.data === "string" ? event.data : await event.data.text();
    const frame = JSON.parse(raw);
    if (frame.type === "workspace.changed" && frame.cwd === worktree) worktreeFrames.push(Date.now());
  });
  await new Promise((resolve) => { worktreeEvents.addEventListener("open", resolve, { once: true }); });
  const stagedAt = Date.now();
  execFileSync("touch", [join(repoGitDirFor(worktree), "index")]);
  await sleep(1500);
  worktreeEvents.close();
  const firstFrame = worktreeFrames[0];
  leg("signal: git state of a linked worktree (its index under the main repository) publishes within 1.5 s", firstFrame !== undefined && firstFrame - stagedAt <= 1500, `${String(worktreeFrames.length)} frames`);
  await api(`sessions/${worktreeSession.id}/archive`, { method: "POST", body: JSON.stringify({ cwd: worktree }) }).catch(() => undefined);
} finally {
  events?.close();
  await browser.close();
  git(["reset", "-q", "--hard", startingCommit]);
  execFileSync("rm", ["-rf", join(REPO, "node_modules"), join(REPO, ".pi"), join(REPO, ".git", "objects", "zz"), join(REPO, ".git", "index.lock")]);
  await api(`sessions/${created.id}/archive`, { method: "POST", body: JSON.stringify({ cwd: REPO }) }).catch(() => undefined);
}
const failed = results.filter((ok) => !ok).length;
console.log(`${String(results.length - failed)}/${String(results.length)} legs passed`);
process.exit(failed === 0 ? 0 : 1);

function repoGitDirFor(worktree) {
  return execFileSync("git", ["-C", worktree, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
}
