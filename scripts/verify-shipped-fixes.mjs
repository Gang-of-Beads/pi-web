/**
 * Regression check for the fixes shipped in 1.202608.19, driven through a real
 * browser against the 8505 preview instance.
 *
 * The state these fixes react to (a question form, subagent rows, background
 * tasks) is normally produced by a running agent, which a check like this must
 * not depend on. So the components are handed that state directly through
 * their properties, exactly where the daemon's events would put it, and the
 * assertions are about what the user then sees and can do.
 */
import { chromium, devices } from "@playwright/test";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:8505";
const projectId = process.env.PROJECT_ID ?? "";
const workspaceId = process.env.WORKSPACE_ID ?? "";
const sessionId = process.env.SESSION_ID ?? "";
const failures = [];

const browser = await chromium.launch();
try {
  await phoneChecks();
  await desktopChecks();
} finally {
  await browser.close();
}

console.log("");
if (failures.length > 0) {
  console.error(`FAILED: ${String(failures.length)} check(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log("All checks passed.");

async function phoneChecks() {
  const context = await browser.newContext({ ...devices["Pixel 7"], hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await open(page);

  // --- composer collapse: the whole feature was inert for pointer users -----
  await seedAsk(page);
  await tapAskField(page);
  const collapsedByTap = await composerState(page);
  report("pointer focus on a form field collapses the composer", collapsedByTap.collapsed, JSON.stringify(collapsedByTap));

  const draftBack = await expandAndReadEditor(page);
  report("expanding rebuilds the editor and restores the draft", draftBack.hasEditor && draftBack.draft.includes("draft-marker"), JSON.stringify(draftBack));

  await tapAskField(page);
  await clearAsk(page);
  const afterFormGone = await composerState(page);
  report("the composer returns once the form is gone", !afterFormGone.collapsed, JSON.stringify(afterFormGone));

  // --- drawer: touch targets and short-viewport floor -----------------------
  await seedActivity(page);
  const sizes = await controlSizes(page);
  const missing = Object.entries(sizes).filter(([, height]) => height === 0);
  const tooSmall = Object.entries(sizes).filter(([, height]) => height > 0 && height < 44);
  report("every drawer control is present and meets the 44px touch height", missing.length === 0 && tooSmall.length === 0, JSON.stringify({ sizes, missing: missing.map(([name]) => name), tooSmall: tooSmall.map(([name]) => name) }));

  // --- drawer: the history control counts what the filter shows -------------
  const history = await historyClaimVsRows(page);
  report("\"Show N finished\" matches the rows it reveals", history.claimed > 0 && history.claimed === history.revealed, JSON.stringify(history));

  // --- dock pill keeps the chosen filter ------------------------------------
  const filterKept = await pillKeepsFilter(page);
  report("opening the drawer from the dock keeps the chosen filter and opens it", filterKept.pillPresent && filterKept.listVisible && filterKept.after === filterKept.before, JSON.stringify(filterKept));

  // --- elapsed time is not announced every second ---------------------------
  const elapsed = await elapsedAnnouncement(page);
  report("the elapsed counter is present and hidden from screen readers", elapsed.present && elapsed.ariaHidden === "true", JSON.stringify(elapsed));

  await page.setViewportSize({ width: 390, height: 400 });
  await page.waitForTimeout(400);
  const shortScreen = await listBox(page);
  report("a keyboard-height viewport still shows drawer rows", shortScreen.clientHeight >= 96, JSON.stringify(shortScreen));
  await page.screenshot({ path: "/tmp/goal-verify/t1/phone-short.png" });

  await context.close();
}

async function desktopChecks() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await open(page);

  // --- a running task's duration has to advance -----------------------------
  const durations = await durationAdvances(page);
  report("a running background task's duration advances", durations.first !== "" && durations.first !== durations.second, JSON.stringify(durations));

  // --- running rows are distinguishable from finished ones ------------------
  const contrast = await rowBackgrounds(page);
  report("running rows are visually distinct from finished rows", contrast.running !== "" && contrast.done !== "" && contrast.running !== contrast.done, JSON.stringify(contrast));

  await page.screenshot({ path: "/tmp/goal-verify/t1/desktop-drawer.png" });
  await context.close();
}

async function open(page) {
  await page.goto(`${baseUrl}/?project=${encodeURIComponent(projectId)}&workspace=${encodeURIComponent(workspaceId)}&session=${encodeURIComponent(sessionId)}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("pi-web-app");
  await page.waitForTimeout(3000);
  // A phone deep link lands on the navigation view even when the URL names a
  // session, so the session row is clicked the way a reader would have to.
  const needsChat = await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    return (app?.shadowRoot?.querySelector("prompt-editor")?.getBoundingClientRect().height ?? 0) === 0;
  });
  if (needsChat) {
    await page.evaluate(() => {
      const app = document.querySelector("pi-web-app");
      const nav = app?.shadowRoot?.querySelector("app-navigation-panel");
      const list = nav?.shadowRoot?.querySelector("session-list");
      const row = list?.shadowRoot?.querySelector("button.action-main");
      if (row instanceof HTMLElement) row.click();
    });
    await page.waitForTimeout(2500);
  }
  const ready = await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    return (app?.shadowRoot?.querySelector("prompt-editor")?.getBoundingClientRect().height ?? 0) > 0;
  });
  if (!ready) throw new Error("chat view never became visible; the harness cannot measure anything");
}

/** Put a question form on screen and a draft in the composer. */
async function seedAsk(page) {
  await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    if (!chat) throw new Error("no chat-view");
    chat.pendingAsk = {
      askId: "probe-ask",
      questions: [{ id: "q1", question: "Which way?", options: [{ value: "a", label: "Option A" }] }],
      askedAt: new Date().toISOString(),
    };
    const editor = app?.shadowRoot?.querySelector("prompt-editor");
    if (editor) editor.draft = "draft-marker text that must survive a collapse";
  });
  await page.waitForTimeout(600);
}

async function clearAsk(page) {
  await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    if (chat) chat.pendingAsk = undefined;
    if (app) app.composerCollapsed = app.composerCollapsed; // keep lit from batching the change away
  });
  await page.waitForTimeout(800);
}

/** A real pointer tap on the first field of the question card. */
async function tapAskField(page) {
  const box = await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    const card = chat?.shadowRoot?.querySelector("ask-user-card");
    const control = card?.shadowRoot?.querySelector("textarea, input, button");
    if (!control) return null;
    const rect = control.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  if (box === null) throw new Error("no ask control to tap");
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(500);
}

async function composerState(page) {
  return await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const editor = app?.shadowRoot?.querySelector("prompt-editor");
    return {
      collapsed: editor?.hasAttribute("collapsed") === true || editor?.collapsed === true,
      height: editor?.getBoundingClientRect().height ?? 0,
    };
  });
}

async function expandAndReadEditor(page) {
  await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const editor = app?.shadowRoot?.querySelector("prompt-editor");
    const expand = editor?.shadowRoot?.querySelector(".expand-composer");
    if (expand instanceof HTMLElement) expand.click();
  });
  await page.waitForTimeout(700);
  return await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const editor = app?.shadowRoot?.querySelector("prompt-editor");
    const cm = editor?.shadowRoot?.querySelector(".cm-editor");
    return { hasEditor: cm !== null && cm !== undefined, draft: editor?.shadowRoot?.querySelector(".cm-content")?.textContent ?? "" };
  });
}

/** Hand the chat view a mix of running and finished work of every kind. */
async function seedActivity(page) {
  // The drawer's rows are polled from disk, so the fixture runs seeded there
  // are what it renders. Injecting the properties directly does not survive
  // the parent's next render.
  const deadline = Date.now() + 20_000;
  for (;;) {
    const rows = await page.evaluate(() => {
      const app = document.querySelector("pi-web-app");
      const chat = app?.shadowRoot?.querySelector("chat-view");
      return chat?.subagentRuns?.length ?? 0;
    });
    if (rows > 0 || Date.now() > deadline) break;
    await page.waitForTimeout(1000);
  }
  await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    const toggle = chat?.shadowRoot?.querySelector(".drawer-toggle, .drawer-header button");
    if (toggle instanceof HTMLElement && chat?.shadowRoot?.querySelector(".subagents-list") === null) toggle.click();
  });
  await page.waitForTimeout(800);
}

async function controlSizes(page) {
  return await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    const root = chat?.shadowRoot;
    const measure = (selector) => {
      const element = root?.querySelector(selector);
      return element === null || element === undefined ? 0 : Math.round(element.getBoundingClientRect().height);
    };
    return {
      drawerTab: measure(".drawer-tab"),
      activityFilter: measure(".activity-filter"),
      historyToggle: measure(".activity-history-toggle"),
      subagentRow: measure(".subagent-row"),
      dockPill: measure(".activity-dock.background"),
    };
  });
}

async function historyClaimVsRows(page) {
  return await page.evaluate(async () => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    const root = chat?.shadowRoot;
    const rowsNow = () => root?.querySelectorAll(".subagent-row").length ?? 0;
    const toggle = root?.querySelector(".activity-history-toggle");
    const claimed = Number((toggle?.textContent ?? "").replace(/\D+/gu, "")) || 0;
    const before = rowsNow();
    if (toggle instanceof HTMLElement) toggle.click();
    await new Promise((resolve) => { setTimeout(resolve, 500); });
    return { claimed, revealed: rowsNow() - before };
  });
}

async function pillKeepsFilter(page) {
  return await page.evaluate(async () => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    chat.activityFilter = "tasks";
    chat.topDrawerOpen = false;
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    const before = chat.activityFilter;
    const pill = chat?.shadowRoot?.querySelector(".activity-dock.background");
    const pillPresent = pill !== null && pill !== undefined;
    if (pill instanceof HTMLElement) pill.click();
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    const list = chat?.shadowRoot?.querySelector(".subagents-list");
    return { before, after: chat.activityFilter, pillPresent, listVisible: list !== null && list !== undefined && list.clientHeight > 0 };
  });
}

async function elapsedAnnouncement(page) {
  return await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    const elapsed = chat?.shadowRoot?.querySelector(".activity-elapsed");
    const dock = chat?.shadowRoot?.querySelector(".activity-dock");
    return { present: elapsed !== null && elapsed !== undefined, ariaHidden: elapsed?.getAttribute("aria-hidden") ?? "", dockLive: dock?.getAttribute("aria-live") ?? "" };
  });
}

async function listBox(page) {
  return await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    const list = chat?.shadowRoot?.querySelector(".subagents-list");
    return { clientHeight: list?.clientHeight ?? 0, scrollHeight: list?.scrollHeight ?? 0, rows: chat?.shadowRoot?.querySelectorAll(".subagent-row").length ?? 0 };
  });
}

async function durationAdvances(page) {
  await seedActivity(page);
  const read = () => page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    const row = [...(chat?.shadowRoot?.querySelectorAll(".subagent-row") ?? [])].find((candidate) => candidate.textContent?.includes("sleep timer"));
    return row?.querySelector(".subagent-duration")?.textContent?.trim() ?? "";
  });
  const first = await read();
  // The daemon repeats the poll with a longer duration; the row must follow.
  await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    chat.backgroundTasks = chat.backgroundTasks.map((task) => task.id === "task-running" ? { ...task, durationMs: task.durationMs + 65_000 } : task);
  });
  await page.waitForTimeout(600);
  const second = await read();
  return { first, second };
}

async function rowBackgrounds(page) {
  // Clicking the control is the only way to reach the history: assigning the
  // scope property is undone by the parent's next render.
  await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    const toggle = chat?.shadowRoot?.querySelector(".activity-history-toggle");
    if (toggle instanceof HTMLElement) toggle.click();
  });
  await page.waitForTimeout(600);
  return await page.evaluate(() => {
    const app = document.querySelector("pi-web-app");
    const chat = app?.shadowRoot?.querySelector("chat-view");
    const rows = [...(chat?.shadowRoot?.querySelectorAll(".subagent-row") ?? [])];
    const running = rows.find((row) => row.className.includes("status-running") || row.className.includes("status-working"));
    const done = rows.find((row) => !row.className.includes("status-running") && !row.className.includes("status-working"));
    const background = (element) => element === undefined ? "" : getComputedStyle(element).backgroundColor;
    return { running: background(running), done: background(done), rows: rows.length, classes: rows.slice(0, 6).map((row) => row.className.replace("subagent-row", "").trim()) };
  });
}

function report(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === undefined ? "" : `  [${detail}]`}`);
  if (!ok) failures.push(name);
}
