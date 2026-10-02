import type { PiWebPlugin, PluginActivationContext, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { html, svg } from "lit";
import { rememberGoalsHostUi } from "./hostUi.js";
import { badgeFor, type GoalsSectionState } from "./goalsSectionElement.js";
import type { GoalRecordSummary } from "./goalRecords.js";
import { goalEventSummary } from "./goalEventSummary.js";

/** Goal lifecycle messages this plugin draws; the shell knows none of them. */
const GOAL_EVENT_TAGS = ["pi-goal-audit-event", "pi-goal-guard", "pi-goal-draft", "pi-goal-focus"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isGoalSummary = (value: unknown): value is GoalRecordSummary => {
  if (!isRecord(value)) return false;
  return typeof value["id"] === "string"
    && typeof value["objective"] === "string"
    && typeof value["status"] === "string"
    && typeof value["tasksTotal"] === "number"
    && typeof value["tasksDone"] === "number"
    && typeof value["updatedAt"] === "string";
};

/**
 * What the section knows for one scope. `read` names where the latest read stands; `answer` is
 * the last answer that arrived, kept while a refresh runs or after a refresh failed.
 */
interface GoalsRead {
  key: string;
  seq: number;
  read: "reading" | "read" | "failed";
  answer?: GoalsSectionState;
}

/**
 * The scope a goals read answers for. `goals.list` takes the session's cwd as well as the
 * workspace, and a narrower session cwd overlays its own goals, so a key on the workspace
 * alone showed one session's goals while another was selected and never asked again.
 */
function readKey(workspacePath: string, sessionCwd: string | undefined): string {
  return JSON.stringify([workspacePath, sessionCwd ?? null]);
}

/** The goals surface as a plugin: one page in the Go to page, carrying the
 *  scope's goal records. Owner, 2026-09-30: plugins do not draw bars over the
 *  transcript; a plugin declares an entry and draws its own page behind it
 *  (docs/design/state-diagram.md, D6 and rule 7). The page owns its
 *  read-through-cache keyed by the scope it was asked for - a read that lands
 *  for another scope never reaches this one. A read that failed says so, so a
 *  machine that could not be read never looks like one with no goals. */
const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Goals",
  activate: (context: PluginActivationContext) => {
    rememberGoalsHostUi(context.ui);
    const callOperation = context.callOperation;
    let cache: GoalsRead | undefined;
    let issued = 0;

    const listGoals = async (workspacePath: string, sessionCwd: string | undefined): Promise<GoalsSectionState> => {
      if (callOperation === undefined) return { goals: [], brokenFiles: 0 };
      const input = sessionCwd === undefined ? { workspacePath } : { workspacePath, sessionCwd };
      const answer = await callOperation("goals.list", input);
      if (!isRecord(answer)) throw new Error("the machine answered without a goal list");
      const rawGoals: unknown[] = Array.isArray(answer["goals"]) ? answer["goals"] : [];
      return { goals: rawGoals.filter(isGoalSummary), brokenFiles: 0 };
    };

    const read = (workspacePath: string, sessionCwd: string | undefined, requestUpdate: () => void): void => {
      const key = readKey(workspacePath, sessionCwd);
      const seq = ++issued;
      cache = { key, seq, read: "reading", ...(cache?.key === key && cache.answer !== undefined ? { answer: cache.answer } : {}) };
      const settle = (next: Pick<GoalsRead, "read" | "answer">): void => {
        if (cache?.key !== key || cache.seq !== seq) return;
        cache = { key, seq, read: next.read, ...(next.answer === undefined ? {} : { answer: next.answer }) };
        requestUpdate();
      };
      void listGoals(workspacePath, sessionCwd).then(
        (answer) => { settle({ read: "read", answer }); },
        () => { settle({ read: "failed", ...(cache?.answer === undefined ? {} : { answer: cache.answer }) }); },
      );
    };
    const cacheFor = (workspacePath: string, sessionCwd: string | undefined): GoalsRead | undefined => (cache?.key === readKey(workspacePath, sessionCwd) ? cache : undefined);
    const reading = (panel: WorkspacePanelContext): GoalsRead | undefined => {
      const workspacePath = panel.workspace.path;
      const sessionCwd = panel.state?.selectedSession?.cwd;
      if (cacheFor(workspacePath, sessionCwd) === undefined) read(workspacePath, sessionCwd, () => { panel.host.requestRender(); });
      return cacheFor(workspacePath, sessionCwd);
    };

    return {
      contributions: {
        messageRenderers: GOAL_EVENT_TAGS.map((tag) => ({
          id: `message.${tag}`,
          tag,
          render: (view: { payload: unknown }) => {
            const summary = goalEventSummary(tag, view.payload);
            return html`<strong>${summary.title}</strong>${summary.detail === undefined ? null : html`<small>${summary.detail}</small>`}`;
          },
        })),
        workspacePanels: [
          {
            id: "goals",
            title: "Goals",
            icon: svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="4.5"></circle><circle cx="12" cy="12" r="0.8"></circle></svg>`,
            order: 30,
            badge: (panel) => badgeFor(reading(panel)?.answer),
            render: (panel) => {
              const workspacePath = panel.workspace.path;
              const sessionCwd = panel.state?.selectedSession?.cwd;
              const requestUpdate = () => { panel.host.requestRender(); };
              const known = reading(panel);
              return html`<pi-web-goals-section
                .state=${known?.answer}
                .failed=${known?.read === "failed"}
                .onRefresh=${() => { read(workspacePath, sessionCwd, requestUpdate); }}
              ></pi-web-goals-section>`;
            },
          },
        ],
      },
    };
  },
};

export default plugin;
