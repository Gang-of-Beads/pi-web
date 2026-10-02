import { chromium } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Files refreshes by itself while its page is on screen (owner, 2026-10-02; state-diagram D5,
 * "Workspace pages stay fresh while someone looks"), 8505, desktop 1440x900.
 *
 * - tree: a top-level `node_modules` folder appears. The workspace watcher drops every change
 *   under `node_modules` as noise, so only the page's own timed read can show it.
 * - open file: a file open in the viewer is rewritten from outside; the viewer shows the new text.
 * - control: Git, which already polled, shows a new file.
 */
const BASE = "http://127.0.0.1:8505";
const ROUTE = "project=991606fd-e498-4b93-a1ce-2af09efdb0e7&workspace=ef2cdf93e1ac&session=01a05000-5eed-7c00-8000-0000000000e1";
const CWD = join(homedir(), ".pi-web-8505", "pi-web-8505-seed-workspace");
const LIMIT_MS = 15_000;
const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` (${detail})`}`);
};

const panelText = (page) => page.evaluate(() => {
  const text = (node) => [...node.childNodes].map((child) => (child.nodeType === 3 ? child.textContent : (child.shadowRoot ? text(child.shadowRoot) : "") + text(child))).join("");
  const root = document.querySelector("pi-web-app")?.shadowRoot?.querySelector("#workspace-panel")?.shadowRoot;
  return root === null || root === undefined ? "" : text(root);
});

async function open(browser, query) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route(/\/api\/machines\/prod-8504-waveb\//u, (route) => route.abort("blockedbyclient"));
  const page = await context.newPage();
  await page.goto(`${BASE}/?${ROUTE}&${query}`);
  await page.waitForTimeout(5000);
  return { context, page };
}

async function waitForText(page, wanted) {
  const started = Date.now();
  while (Date.now() - started < LIMIT_MS) {
    if ((await panelText(page)).includes(wanted)) return Date.now() - started;
    await page.waitForTimeout(250);
  }
  return undefined;
}

const stamp = String(Date.now());
const noisy = join(CWD, "node_modules");
const opened = `probe-files-fresh-${stamp}.md`;
const gitFile = `probe-git-fresh-${stamp}.md`;
const browser = await chromium.launch();
try {
  await rm(noisy, { recursive: true, force: true });
  {
    const { context, page } = await open(browser, "tool=files%3Afiles&view=files%3Afiles");
    const before = await panelText(page);
    check("precondition: the Files tree drew, without a node_modules folder", before.includes("README.md") && !before.includes("node_modules"), `${String(before.length)} chars`);
    await mkdir(noisy, { recursive: true });
    await writeFile(join(noisy, "probe.txt"), "a change the watcher drops\n");
    const seen = await waitForText(page, "node_modules");
    check(`tree: a change the watcher ignores shows within ${String(LIMIT_MS / 1000)} s`, seen !== undefined, seen === undefined ? "never" : `${String(seen)} ms`);
    await context.close();
  }
  {
    await writeFile(join(CWD, opened), "first text\n");
    const { context, page } = await open(browser, `tool=files%3Afiles&view=files%3Afiles&core.workspace.files--file=${encodeURIComponent(opened)}`);
    const shownFirst = (await panelText(page)).includes("first text");
    check("precondition: the open file shows its first text", shownFirst);
    await writeFile(join(CWD, opened), "second text\n");
    const seen = await waitForText(page, "second text");
    check(`open file: the viewer shows the rewritten text within ${String(LIMIT_MS / 1000)} s`, seen !== undefined, seen === undefined ? "never" : `${String(seen)} ms`);
    await page.screenshot({ path: "/tmp/surfaces/files-fresh-open-file.png" });
    await context.close();
  }
  {
    const { context, page } = await open(browser, "tool=git%3Aworkspace.git&view=git%3Aworkspace.git");
    await writeFile(join(CWD, gitFile), "for git\n");
    const seen = await waitForText(page, gitFile);
    check(`control: Git shows a new file within ${String(LIMIT_MS / 1000)} s`, seen !== undefined, seen === undefined ? "never" : `${String(seen)} ms`);
    await context.close();
  }
} finally {
  await browser.close();
  await rm(noisy, { recursive: true, force: true });
  await rm(join(CWD, opened), { force: true });
  await rm(join(CWD, gitFile), { force: true });
}
const failed = results.filter((pass) => !pass).length;
console.log(`${String(results.length - failed)}/${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
