#!/usr/bin/env node
/**
 * Live check at 393x850 for the two selection → composer consumers:
 * 1. transcript: select text → the "Ask here" chip appears and inserts the
 *    quoted prompt into the composer;
 * 2. files viewer: open README.md, select text in the raw view → the
 *    @path:start-end chip appears and inserts the mention.
 * Preconditions fail loudly.
 */
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const MANIFEST = `${process.env.HOME}/.pi-web-8505/pi-web-8505-seed-workspace/seed-manifest.json`;
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
function fail(message) { console.error(`FAIL: ${message}`); process.exit(1); }

const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
const cwd = manifest.workspace;

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await (await browser.newContext({ viewport: { width: 393, height: 850 }, hasTouch: true, isMobile: true })).newPage();

const pageScript = `
  function deepAll(root, selector) {
    const out = [];
    const queue = [root];
    const seen = new Set();
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === null || current === undefined || seen.has(current)) continue;
      seen.add(current);
      for (const el of current.querySelectorAll(selector)) out.push(el);
      for (const el of current.querySelectorAll("*")) if (el.shadowRoot) queue.push(el.shadowRoot);
    }
    return out;
  }
  function deepOne(root, selector) {
    const all = deepAll(root, selector);
    return all.length === 0 ? null : all[0];
  }
`;

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app");
  await page.waitForTimeout(3000);
  const opened = await page.evaluate(`(async function(){
    const app = document.querySelector("pi-web-app");
    const project = Reflect.get(app, "state").projects.find((p) => p.path === ${JSON.stringify(cwd)});
    if (!project) return { error: "seed project missing" };
    await Reflect.get(app, "workspaces").selectProject(project);
    await new Promise((r) => setTimeout(r, 2500));
    const target = (Reflect.get(app, "state").sessions ?? [])[0];
    if (!target) return { error: "no session listed" };
    await app.selectNavigationItem("sessions", "chat", () => Reflect.get(app, "sessions").selectSession(target));
    await new Promise((r) => setTimeout(r, 3000));
    return {};
  })()`);
  if (opened.error !== undefined) fail(opened.error);

  const quote = await page.evaluate(`(async function(){
    const app = document.querySelector("pi-web-app");
    const chat = app.shadowRoot.querySelector("chat-view");
    const part = chat.shadowRoot.querySelector("article.msg formatted-text");
    if (!part || !part.shadowRoot) return { error: "no formatted-text part with a shadow root" };
    const card = part.shadowRoot.querySelector("p");
    if (!card) return { error: "no paragraph inside the formatted part" };
    const range = document.createRange();
    range.selectNodeContents(card);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((r) => setTimeout(r, 600));
    const chip = chat.shadowRoot.querySelector("button.quote-chip");
    if (!chip) return { error: "Ask here chip did not appear" };
    chip.click();
    await new Promise((r) => setTimeout(r, 500));
    const editor = app.shadowRoot.querySelector("prompt-editor");
    const text = editor?.shadowRoot?.querySelector(".markdown-editor")?.textContent ?? "";
    return { chipText: chip.textContent.trim(), composerHasQuote: text.includes("> "), sample: text.slice(0, 60) };
  })()`);
  if (quote.error !== undefined) fail(quote.error);
  console.log(JSON.stringify(quote));
  if (quote.composerHasQuote !== true) fail(`composer did not receive the quoted prompt (${quote.sample})`);

  const mention = await page.evaluate(`(async function(){
    ${pageScript}
    const app = document.querySelector("pi-web-app");
    Reflect.get(app, "openWorkspaceTool").call(app, "files:files");
    await new Promise((r) => setTimeout(r, 2500));
    const panel = app.shadowRoot.querySelector("workspace-panel");
    if (!panel) return { error: "no workspace-panel" };
    const readme = deepAll(panel.shadowRoot, "button").find((b) => b.textContent.includes("README.md"));
    if (readme === undefined) return { error: "no README.md row in the files tree" };
    readme.click();
    await new Promise((r) => setTimeout(r, 1500));
    const codeViewer = deepOne(panel.shadowRoot, "pi-code-viewer");
    if (codeViewer === null) return { error: "code viewer did not mount after opening README.md" };
    const content = codeViewer.shadowRoot.querySelector(".cm-content");
    if (content === null) return { error: "no cm-content in the code viewer" };
    const line = content.querySelector(".cm-line");
    if (line === null || (line.textContent ?? "").length < 2) return { error: "code viewer's first line is too short to select" };
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    const lineText = walker.nextNode();
    if (lineText === null) return { error: "the first code line has no text node" };
    const range = document.createRange();
    range.setStart(lineText, 0);
    range.setEnd(lineText, Math.min(20, (lineText.textContent ?? "").length));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((r) => setTimeout(r, 600));
    const chip = deepOne(panel.shadowRoot, "button.mention-chip");
    if (chip === null) return { error: "mention chip did not appear" };
    const ref = chip.textContent.trim();
    chip.click();
    await new Promise((r) => setTimeout(r, 500));
    const editor = app.shadowRoot.querySelector("prompt-editor");
    const text = editor?.shadowRoot?.querySelector(".markdown-editor")?.textContent ?? "";
    return { ref, composerHasMention: text.includes(ref), sample: text.slice(0, 60) };
  })()`);
  if (mention.error !== undefined) fail(mention.error);
  console.log(JSON.stringify(mention));
  if (mention.composerHasMention !== true) fail(`composer did not receive the mention (${mention.sample})`);
  if (!/^@[\w./-]+:\d+(-\d+)?$/.test(mention.ref)) fail(`mention ref malformed: ${mention.ref}`);
  await page.screenshot({ path: "/tmp/journeys/selection-consumers.png" });
  console.log("PASS: Ask here quotes into the composer; the viewer chip inserts @path:start-end");
} finally {
  await browser.close();
}
