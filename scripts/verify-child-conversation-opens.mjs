/**
 * Live check that an agent-run row opens the child's conversation.
 *
 * The regression this guards is specific: the click set state that nothing
 * rendered, so a row that used to open a block of text opened nothing at all.
 * A row is therefore clicked for real and the dialog is measured afterwards.
 *
 * The run is chosen rather than stumbled upon. An activity list mixes runs that
 * have a transcript with husks - empty run directories left by a child that died
 * before writing anything - and a husk has no conversation to draw: the server
 * answers 404 and the client falls back to the log viewer, which is correct
 * behaviour, not the regression. Clicking whichever row came first therefore
 * asserted against a row that could never satisfy it, and the outcome depended
 * on whether a live run happened to be at the top. The run is now picked from
 * the API by asking which ones actually serve messages, and the check FAILS when
 * none do rather than quietly testing a husk.
 *
 * FINISHED RUNS ARE COLLAPSED BY DEFAULT. The activity drawer shows only what is
 * not in a terminal state and keeps the rest behind a "Show N finished" control
 * (ChatView.renderActivityPanel; terminal means done/failed/error/lost/stopped).
 * A run row therefore appears without expanding only while it is still running -
 * once it finishes it is one click away. The API listing 25 runs while the
 * drawer renders 6 is that rule, not a defect, and this check expands the list
 * when the run it chose is not on screen.
 *
 * Usage: node scripts/verify-child-conversation-opens.mjs [port]
 */
import { chromium } from "@playwright/test";

const PORT = process.argv[2] ?? "8505";
/** Terminal statuses, mirroring isFinishedActivityStatus in ChatView.ts. */
const FINISHED_STATUSES = new Set(["done", "failed", "error", "lost", "stopped"]);
const EXE = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CWD = process.env.PI_WEB_VERIFY_CWD ?? "/Users/hanxiao.du/Desktop/vincent/projects/pi-web";
const API = `http://127.0.0.1:${PORT}/api/machines/local`;

const DEEP_CLICK = (needle) => {
  const walk = (root, out = []) => {
    for (const el of root.querySelectorAll("button,[role=option],[role=listitem],li,[aria-label]")) out.push(el);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
    return out;
  };
  const hit = walk(document).find((x) => `${x.getAttribute("aria-label") ?? ""} ${(x.textContent ?? "").trim()}`.toLowerCase().includes(needle.toLowerCase()));
  hit?.click();
  return hit !== undefined;
};

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) return undefined;
  return response.json();
}

/**
 * The runs of this session that actually have a conversation to open, newest
 * first. Asking the messages route is the only honest test: `hasOutput` is
 * about the result artifact, and a live child has a transcript before it has
 * any result at all.
 */
async function runsWithATranscript(sessionId) {
  const query = `cwd=${encodeURIComponent(CWD)}`;
  const snapshot = await readJson(`${API}/sessions/${encodeURIComponent(sessionId)}/subsessions?${query}`);
  const runs = snapshot?.toolRuns ?? [];
  const withTranscript = [];
  for (const run of runs) {
    const page = await readJson(`${API}/sessions/${encodeURIComponent(sessionId)}/subagent-runs/${encodeURIComponent(run.runId)}/messages?${query}&limit=1`);
    if (page !== undefined && (page.total ?? 0) > 0) withTranscript.push({ ...run, total: page.total, collapsed: FINISHED_STATUSES.has(run.status) });
  }
  // A run the reader can reach without expanding first, so the check exercises
  // the path most of them take. In practice only a still-running child
  // qualifies, because finishing is what collapses a row.
  withTranscript.sort((left, right) => Number(left.collapsed) - Number(right.collapsed));
  return { total: runs.length, withTranscript };
}

/**
 * Reveal the finished rows, and report whether the control was there to use.
 * Called only when the chosen run is not already on screen.
 */
async function revealFinishedRuns(page) {
  const expanded = await page.evaluate(() => {
    const walk = (root, out = []) => {
      for (const el of root.querySelectorAll("button.activity-history-toggle")) out.push(el);
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
      return out;
    };
    const toggle = walk(document)[0];
    if (toggle === undefined) return { found: false };
    const label = (toggle.textContent ?? "").trim();
    if (toggle.getAttribute("aria-expanded") === "true") return { found: true, alreadyOpen: true, label };
    toggle.click();
    return { found: true, alreadyOpen: false, label };
  });
  await page.waitForTimeout(1500);
  return expanded;
}

const browser = await chromium.launch({ executablePath: EXE });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  await page.evaluate(DEEP_CLICK, "pi-web/Users");
  await page.waitForTimeout(2000);
  await page.evaluate(DEEP_CLICK, "main");
  await page.waitForTimeout(2500);

  const opened = await page.evaluate(() => {
    const walk = (root, out = []) => {
      for (const el of root.querySelectorAll("button,[role=listitem],li")) out.push(el);
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
      return out;
    };
    const rows = walk(document)
      .map((el) => ({ el, count: Number(/(\d+)\s+messages/u.exec(el.textContent ?? "")?.[1] ?? 0) }))
      .filter((row) => row.count > 0)
      .sort((left, right) => right.count - left.count);
    rows[0]?.el.click();
    return rows[0]?.count ?? 0;
  });
  await page.waitForTimeout(9000);

  if (opened === 0) {
    console.error("FAIL: no conversation was opened, so no activity row was reachable");
    process.exit(1);
  }

  const sessionId = await page.evaluate(() => new URL(window.location.href).searchParams.get("session"));
  if (sessionId === null) {
    console.error("FAIL: the opened session is not in the url, so no run could be chosen deliberately");
    process.exit(1);
  }

  const { total, withTranscript } = await runsWithATranscript(sessionId);
  console.log(`runs: ${String(total)} listed, ${String(withTranscript.length)} with a transcript`);

  // An empty pass is worse than a red: without a run that has a conversation,
  // this check cannot say anything about the view.
  if (withTranscript.length === 0) {
    console.error(`FAIL: none of the ${String(total)} runs on this session has a transcript, so the conversation view was not exercised.`);
    console.error("       Start a subagent in the sandbox session and run this again.");
    process.exit(1);
  }

  const target = withTranscript[0];
  const shortId = target.runId.slice(0, 8);
  const visibleCount = withTranscript.filter((run) => !run.collapsed).length;
  console.log(`target: ${shortId} agent=${target.agent} status=${target.status} messages=${String(target.total)} ${target.collapsed ? "(collapsed by default)" : "(visible by default)"}`);
  console.log(`        ${String(visibleCount)} of ${String(withTranscript.length)} transcript-bearing runs are visible without expanding`);

  await page.evaluate(DEEP_CLICK, "Activity");
  await page.waitForTimeout(2000);

  // Matched on what the row draws for this run - its agent name and status -
  // rather than on position, so the click lands on the run that was chosen.
  const findAndClick = ({ agent, status }) => {
    const walk = (root, out = []) => {
      for (const el of root.querySelectorAll("button.subagent-row")) out.push(el);
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot, out);
      return out;
    };
    const rows = walk(document);
    const candidates = rows.filter((el) => {
      const id = el.querySelector(".subagent-id")?.textContent?.trim();
      return id === agent && el.className.includes(`status-${status}`);
    });
    const run = candidates[0];
    if (run === undefined) {
      return { found: false, rowCount: rows.length, seen: rows.map((el) => `${el.querySelector(".subagent-id")?.textContent?.trim() ?? "?"}/${el.className.replace(/^.*status-/u, "")}`).slice(0, 8) };
    }
    run.click();
    return { found: true, rowCount: rows.length, label: (run.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 60) };
  };

  // The reader's own path first: click what is already on screen. Only when the
  // chosen run is behind the history control is that control used, so the
  // common case stays the one being exercised.
  let clicked = await page.evaluate(findAndClick, { agent: target.agent, status: target.status });
  let expanded;
  if (!clicked.found) {
    expanded = await revealFinishedRuns(page);
    console.log("expanded:", JSON.stringify(expanded));
    if (expanded.found) clicked = await page.evaluate(findAndClick, { agent: target.agent, status: target.status });
  }
  await page.waitForTimeout(4000);

  const measured = await page.evaluate(() => {
    let conversation;
    let blob;
    const walk = (root) => {
      for (const el of root.querySelectorAll("dialog.activity-conversation")) conversation ??= el;
      for (const el of root.querySelectorAll("dialog.activity-output")) blob ??= el;
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
    };
    walk(document);
    if (conversation === undefined) return { dialogPresent: false };
    return {
      dialogPresent: true,
      open: conversation.open,
      title: conversation.querySelector(".activity-conversation-title")?.textContent?.trim(),
      subtitle: conversation.querySelector(".activity-conversation-subtitle")?.textContent?.trim(),
      boundary: conversation.querySelector(".activity-conversation-boundary")?.textContent?.trim(),
      messageRows: conversation.querySelectorAll(".activity-conversation-body article.msg").length,
      blobPresent: conversation.querySelector("pre") !== null,
      closePresent: conversation.querySelector(".activity-conversation-close") !== null,
      // A run with a transcript must not land in the log viewer.
      blobDialogOpen: blob?.open ?? false,
    };
  });

  console.log("clicked:", JSON.stringify(clicked));
  console.log("dialog :", JSON.stringify(measured));

  if (!clicked.found) {
    // Distinct from "no run has a transcript": the run exists and serves
    // messages, but no row was ever rendered for it. That is a defect in the
    // list, not in the data, so it is reported as its own thing.
    console.error(`FAIL: run ${shortId} serves ${String(target.total)} messages, but no row for it was rendered even after revealing finished runs.`);
    console.error(`       Looked for agent=${target.agent} status=${target.status}. Rows on screen: ${JSON.stringify(clicked.seen ?? [])}`);
    if (expanded !== undefined && !expanded.found) console.error("       The \"Show N finished\" control was not present, so the collapsed rows could not be revealed.");
    process.exitCode = 1;
  } else if (measured.dialogPresent !== true || measured.open !== true) {
    console.error("FAIL: clicking a run that has a transcript did not open the conversation - this is the regression");
    process.exitCode = 1;
  } else if (measured.blobDialogOpen === true) {
    console.error("FAIL: a run with a transcript opened the log viewer instead of its conversation");
    process.exitCode = 1;
  } else if (measured.title === undefined || !measured.title.includes(shortId)) {
    console.error(`FAIL: the conversation that opened is not the run that was chosen (wanted ${shortId}, got ${String(measured.title)})`);
    process.exitCode = 1;
  } else if (measured.messageRows === 0) {
    console.error("FAIL: the conversation opened with no turns in it");
    process.exitCode = 1;
  } else if (measured.blobPresent) {
    console.error("FAIL: the run still rendered as a block of text");
    process.exitCode = 1;
  } else if (measured.boundary === undefined || measured.boundary === "") {
    console.error("FAIL: the view did not say that steering is unavailable here");
    process.exitCode = 1;
  } else if (measured.closePresent !== true) {
    console.error("FAIL: the view offered no way back");
    process.exitCode = 1;
  } else {
    console.log(`PASS  "${measured.title}" ${String(measured.messageRows)} turns, boundary stated, way back present`);
  }
} finally {
  await browser.close();
}
