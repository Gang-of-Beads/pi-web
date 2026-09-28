/**
 * Everything this session is running reads as one status line, whole and on screen.
 *
 * The owner rejected a strip of chips above the dock ("Background · 404 finished" that
 * opened a raw dump over the transcript): background work is part of the session's status,
 * so it rides the dock's own line in every state and no chip strip exists at all. The review
 * then measured the merged line overflowing the screen at 320px and a long label ellipsizing
 * the note away, and the dock vanishing with its note while a question card was open. Each
 * state is set on the real chat view and measured at phone widths.
 */
import { chromium } from "playwright";
import { PROBE_BASE, openProbedSession } from "./probeSession.mjs";

const fails = [];
const fail = (message) => { fails.push(message); console.log("FAIL", message); };

const NOTE = "407 background runs";
const STATES = [
  { name: "working-long", status: { isStreaming: true }, activity: { phase: "active", label: "receiving response from the model with a long label" } },
  { name: "asking-dialog", dialog: true },
  { name: "idle", status: { isStreaming: false }, activity: { phase: "idle", label: "idle" } },
  { name: "question-open", ask: true, status: { isStreaming: true }, activity: { phase: "active", label: "agent running" } },
];

for (const width of [320, 393]) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 850 }, hasTouch: true, isMobile: true });
  await openProbedSession(page, PROBE_BASE);
  await page.waitForTimeout(2500);
  for (const state of STATES) {
    const result = await page.evaluate(async ({ state, note }) => {
      const find = (root) => {
        for (const node of root.querySelectorAll("*")) {
          if (node.tagName === "CHAT-VIEW") return node;
          if (node.shadowRoot) {
            const inner = find(node.shadowRoot);
            if (inner) return inner;
          }
        }
        return null;
      };
      const view = find(document);
      if (view === null || view.shadowRoot === null) return { error: "no chat-view" };
      const pinned = {
        activityNotes: [{ id: "probe:n", pluginId: "probe", localId: "n", note: () => note }],
        status: { ...(view.status ?? {}), isCompacting: false, isBashRunning: false, pendingMessageCount: 0, queuedMessages: [], ...(state.status ?? {}), backgroundRunCount: 407 },
        activity: state.activity === undefined ? view.activity : { sessionId: view.sessionId, at: "", ...state.activity },
        pendingAsk: state.ask === true ? { askId: "probe", askedAt: "", questions: [{ id: "q", question: "Ship?", options: [] }] } : undefined,
        pendingAsks: [],
        pendingDialogs: state.dialog === true ? (view.pendingDialogs.length > 0 ? view.pendingDialogs : [{ id: "probe-dialog", kind: "confirm", title: "Probe dialog", message: "" }]) : [],
        isSendingPrompt: false,
      };
      for (const [name, value] of Object.entries(pinned)) {
        Object.defineProperty(view, name, { configurable: true, get: () => value, set: () => undefined });
      }
      view.requestUpdate();
      await view.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 200));
      const dock = view.shadowRoot.querySelector(".activity-dock");
      const noteNode = dock?.querySelector(".activity-note");
      const rect = dock?.getBoundingClientRect();
      const noteRect = noteNode?.getBoundingClientRect();
      const measured = {
        strip: view.shadowRoot.querySelectorAll(".runs, .runs-chip, .runs-body").length,
        cls: dock?.getAttribute("class") ?? null,
        text: dock?.textContent?.replace(/\s+/gu, " ").trim() ?? null,
        dockRight: rect === undefined ? null : Math.round(rect.right),
        noteRight: noteRect === undefined ? null : Math.round(noteRect.right),
        noteWhole: noteNode === null || noteNode === undefined ? null : noteNode.scrollWidth <= noteNode.clientWidth + 1,
        viewport: window.innerWidth,
      };
      for (const name of Object.keys(pinned)) Reflect.deleteProperty(view, name);
      view.requestUpdate();
      await view.updateComplete;
      return measured;
    }, { state, note: NOTE });
    console.log(`${String(width)} ${state.name}:`, JSON.stringify(result));
    const where = `${String(width)}px ${state.name}`;
    if (result.error !== undefined) { fail(`${where}: precondition missing - ${result.error}`); continue; }
    if (result.strip !== 0) fail(`${where}: a chip strip renders`);
    if (result.text === null) { fail(`${where}: no dock, so the note is not shown`); continue; }
    if (!result.text.includes(NOTE)) fail(`${where}: the dock does not carry the note: ${result.text}`);
    if (result.noteWhole !== true) fail(`${where}: the note is clipped`);
    if (result.dockRight !== null && result.dockRight > result.viewport) fail(`${where}: the dock overflows the screen (${String(result.dockRight)} > ${String(result.viewport)})`);
    if (result.noteRight !== null && result.dockRight !== null && result.noteRight > result.dockRight) fail(`${where}: the note spills out of the dock (${String(result.noteRight)} > ${String(result.dockRight)})`);
  }
  await page.screenshot({ path: `/tmp/status-merged-${String(width)}.png` });
  await browser.close();
}

console.log(fails.length === 0 ? "PASS status-merged" : `FAIL status-merged (${String(fails.length)})`);
process.exit(fails.length === 0 ? 0 : 1);
