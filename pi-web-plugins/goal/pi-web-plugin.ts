import type { TemplateResult } from "lit";
import type { GlobalPanelContext, HtmlTemplateTag, ListItemContext, PiWebPlugin, PluginActivationContext, PluginButton, PluginHostUi, PluginPanelSession, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { GOAL_SURFACE, parseAllGoalsRead, parseWorkspaceGoalsRead, type GoalRecord, type WorkspaceGoals } from "./goalRecords.js";
import { AVAILABILITY_WORDS, commandArgs, commandAvailability, commandFeedback, commandLabel, goalCommands, type CommandFeedback, type GoalCommand } from "./goalPresentation.js";
import { createReadings, type Reading } from "./goalReadings.js";
import { renderGoalPlanCall, renderGoalTodoCall } from "./goalToolCards.js";
import { buttonRow, globalListModel, goalBody, sessionLabel, sharedIds, workspaceListModel, type GoalRowOptions } from "./goalViews.js";

/**
 * Goal: PI WEB's pages for pi-goal, the Pi extension that turns a goal into confirmed TODOs the
 * agent carries out.
 *
 * pi-goal stays the owner of goals. The workspace page lists the goals pi-goal stored for the
 * folder of the session on screen and runs pi-goal's own `/goal` command for every change (new,
 * run, pause, status), so pi-goal's checks and dialogs apply as in its terminal panel. The global
 * page lists every folder's goals, read-only. A session tile in Navigate names the open goal the
 * session created, and pi-goal's two tools draw as cards of their own in the transcript.
 *
 * Every read is keyed by the machine and folder it was read for and drawn only for that key: a
 * page switched to another folder shows "reading", never the previous folder's goals with live
 * buttons on them. What a command leaves behind (its busy mark, its answer, the new-goal draft) is
 * keyed by the session too, since the command ran in one session.
 */
const WORKSPACE_PAGE = "workspace.goals";
const GLOBAL_PAGE = "global.goals";
const PAGE_REFRESH_MS = 5_000;
const LABEL_REFRESH_MS = 30_000;

interface WorkspaceScope {
  /** The folder the goals were read for, on its machine. */
  readonly key: string;
  /** The folder and the session the page's commands run in. */
  readonly commandKey: string;
  readonly machineId: string;
  readonly directory: string;
  readonly session: PluginPanelSession | undefined;
}

/** The latest redraw of each surface, from the context it was last drawn with. */
interface Rerenders {
  workspace: (() => void) | undefined;
  global: (() => void) | undefined;
  readonly labels: Map<string, () => void>;
}

interface AllGoals {
  readonly workspaces: readonly WorkspaceGoals[];
  readonly skippedWorkspaces: number;
}

function workspaceScope(context: WorkspacePanelContext): WorkspaceScope {
  const session = context.session;
  const directory = session?.cwd ?? context.workspace.path;
  const key = `${context.machine.id}\u0000${directory}`;
  return { key, commandKey: `${key}\u0000${session?.id ?? ""}`, machineId: context.machine.id, directory, session };
}

function describeError(ui: PluginHostUi | undefined, error: unknown): string {
  if (ui !== undefined) return ui.describeError(error);
  return error instanceof Error ? error.message : String(error);
}

/** A path without trailing separators, except a root (`/`, `C:\\`), which keeps its own. */
function comparablePath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/u, "");
  return trimmed === "" || /^[A-Za-z]:$/u.test(trimmed) ? path : trimmed;
}

const NOT_READ: Reading<never> = { read: "reading", value: undefined, error: undefined };

function readNotes<T>(ui: PluginHostUi | undefined, reading: Reading<T>): string[] {
  return reading.read === "failed" && reading.error !== undefined ? [`Last read failed: ${describeError(ui, reading.error)}`] : [];
}

const goalIcon = (svg: PluginActivationContext["svg"]): TemplateResult => svg`
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"></circle>
    <circle cx="12" cy="12" r="5"></circle>
    <circle cx="12" cy="12" r="1"></circle>
  </svg>
`;

function feedbackLine(html: HtmlTemplateTag, feedback: CommandFeedback | undefined): TemplateResult {
  const color = feedback?.tone === "problem" ? "var(--pi-danger)" : "var(--pi-text-secondary)";
  return html`<p role="status" style="margin:0;min-height:1.25em;color:${color};white-space:pre-wrap;overflow-wrap:anywhere">${feedback?.text ?? ""}</p>`;
}

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Goal",
  activate: (activation) => {
    const { html, svg, ui, callOperation, runtimePluginId } = activation;
    const workspacePageId = `${runtimePluginId}:${WORKSPACE_PAGE}`;
    const globalPageId = `${runtimePluginId}:${GLOBAL_PAGE}`;
    const workspaceReadings = createReadings<WorkspaceGoals>();
    const allReadings = createReadings<AllGoals>();
    const expanded = new Set<string>();
    const busy = new Set<string>();
    const feedback = new Map<string, CommandFeedback>();
    const rerender: Rerenders = { workspace: undefined, global: undefined, labels: new Map() };
    let shownPage: string | undefined;
    let fieldScope: string | undefined;
    let fieldSlot = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const rerenderAll = (): void => {
      rerender.workspace?.();
      rerender.global?.();
      for (const render of rerender.labels.values()) render();
    };

    const readWorkspace = async (directory: string): Promise<WorkspaceGoals> => {
      if (callOperation === undefined) throw new Error("This PI WEB cannot call the plugin's server half.");
      const answer = parseWorkspaceGoalsRead(await callOperation("goals.workspace", { path: directory }));
      if (answer === undefined) throw new Error("The machine gave an answer this page cannot read.");
      if (answer.state === "failed") throw new Error(answer.error);
      if (comparablePath(answer.directory) !== comparablePath(directory)) throw new Error(`The machine answered for ${answer.directory}, not ${directory}.`);
      return answer;
    };

    const readAll = async (): Promise<AllGoals> => {
      if (callOperation === undefined) throw new Error("This PI WEB cannot call the plugin's server half.");
      const answer = parseAllGoalsRead(await callOperation("goals.all", {}));
      if (answer === undefined) throw new Error("The machine gave an answer this page cannot read.");
      if (answer.state === "failed") throw new Error(answer.error);
      return answer;
    };

    const workspaceReading = (scope: WorkspaceScope, shown: boolean): Reading<WorkspaceGoals> => shown
      ? workspaceReadings.ensure(scope.key, () => readWorkspace(scope.directory), PAGE_REFRESH_MS, rerenderAll)
      : workspaceReadings.peek(scope.key) ?? NOT_READ;

    const allReading = (machineId: string, maxAgeMs: number, shown: boolean): Reading<AllGoals> => shown
      ? allReadings.ensure(machineId, readAll, maxAgeMs, rerenderAll)
      : allReadings.peek(machineId) ?? NOT_READ;

    const toggle = (key: string): void => {
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      rerenderAll();
    };

    const runGoalCommand = async (scope: WorkspaceScope, args: string, busyKey: string, quietWords: string | undefined): Promise<boolean> => {
      const session = scope.session;
      const runCommand = session?.runCommand;
      if (session === undefined || runCommand === undefined) return false;
      busy.add(busyKey);
      feedback.delete(scope.commandKey);
      rerenderAll();
      try {
        const outcome = await runCommand({ sessionId: session.id, name: "goal", args });
        feedback.set(scope.commandKey, commandFeedback(outcome, quietWords));
        return outcome.kind !== "refused";
      } catch (error) {
        feedback.set(scope.commandKey, { tone: "problem", text: describeError(ui, error) });
        return false;
      } finally {
        busy.delete(busyKey);
        workspaceReadings.invalidate(scope.key);
        allReadings.invalidateAll();
        rerenderAll();
      }
    };

    const goalControls = (scope: WorkspaceScope, goal: GoalRecord, shared: ReadonlySet<number>): TemplateResult | undefined => {
      if (ui === undefined) return undefined;
      const availability = commandAvailability(scope.session);
      if (availability !== "ready") return html`<div style="color:var(--pi-muted)">${AVAILABILITY_WORDS[availability].note}</div>`;
      if (shared.has(goal.id)) return html`<div style="color:var(--pi-muted)">Another goal here also has #${String(goal.id)}; pi-goal renumbers one when a session loads this folder. Reload the session's extensions with /reload, then act on it.</div>`;
      const buttons = goalCommands(goal).map((command: GoalCommand): PluginButton => {
        const busyKey = `${scope.commandKey}\u0000${goal.uuid}\u0000${command}`;
        return {
          label: commandLabel(command, goal),
          primary: command === "run",
          busy: busy.has(busyKey),
          run: () => { void runGoalCommand(scope, commandArgs(command, goal), busyKey, command === "status" ? "pi-goal showed the status in the chat." : undefined); },
        };
      });
      return buttonRow(html, ui, buttons);
    };

    const rowOptions = (prefix: string, sessionId: string | undefined, controls: (goal: GoalRecord) => TemplateResult | undefined): GoalRowOptions => ({
      now: Date.now(),
      sessionId,
      expanded: (goal) => expanded.has(`${prefix}\u0000${goal.uuid}`),
      toggle: (goal) => { toggle(`${prefix}\u0000${goal.uuid}`); },
      body: (goal) => goalBody(html, goal, controls(goal)),
    });

    /**
     * The new-goal field. The host keeps a field's draft in its element, so the element must not
     * outlive the scope it was typed for: when the folder or session changes, the field is drawn
     * in the other of two wrapper templates, and Lit replaces the element and its draft.
     */
    const newGoalField = (scope: WorkspaceScope): TemplateResult | string => {
      const render = ui?.renderMessageField;
      if (render === undefined) return "";
      if (fieldScope !== scope.commandKey) {
        fieldScope = scope.commandKey;
        fieldSlot = !fieldSlot;
      }
      const availability = commandAvailability(scope.session);
      const field = render({
        label: "New goal",
        placeholder: availability === "ready" ? "Describe a goal; pi-goal clarifies it in the chat" : AVAILABILITY_WORDS[availability].placeholder,
        sendLabel: "Add goal",
        disabled: availability !== "ready",
        send: (text) => runGoalCommand(scope, text, `${scope.commandKey}\u0000new`, undefined),
      });
      return fieldSlot ? html`<div>${field}</div>` : html`<div data-field-slot>${field}</div>`;
    };

    const renderWorkspacePage = (context: WorkspacePanelContext): TemplateResult => {
      if (ui?.renderList === undefined || callOperation === undefined) return html`<p class="muted">This page needs a newer PI WEB on this device.</p>`;
      rerender.workspace = () => { context.host.requestRender(); };
      const scope = workspaceScope(context);
      const reading = workspaceReading(scope, context.host.shown?.() !== false);
      const shared = sharedIds(reading.value?.goals ?? []);
      const model = workspaceListModel({ read: reading.read, goals: reading.value, rows: rowOptions(scope.key, scope.session?.id, (goal) => goalControls(scope, goal, shared)) });
      return html`
        <div style="display:grid;gap:6px;padding:var(--pi-space-6) var(--pi-bar-inset) var(--pi-space-2)">
          ${newGoalField(scope)}
          ${feedbackLine(html, feedback.get(scope.commandKey))}
        </div>
        ${ui.renderList({ ...model, notes: [...model.notes ?? [], ...readNotes(ui, reading)] })}
      `;
    };

    const renderWorkspaceToolbar = (context: WorkspacePanelContext): TemplateResult => {
      const scope = workspaceScope(context);
      const folder = scope.directory.split(/[\\/]/u).filter((part) => part !== "").at(-1) ?? scope.directory;
      const availability = commandAvailability(scope.session);
      const status = availability === "ready" ? folder : `${folder} · ${AVAILABILITY_WORDS[availability].toolbar}`;
      const refresh = (): void => { workspaceReadings.invalidate(scope.key); context.host.requestRender(); };
      return html`
        ${ui?.renderButton === undefined ? html`<button type="button" @click=${refresh}>Refresh</button>` : ui.renderButton({ label: "Refresh", run: refresh })}
        <span style="margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--pi-muted);font-size:var(--pi-text-xs)" title=${scope.directory}>${status}</span>
      `;
    };

    const renderGlobalPage = (context: GlobalPanelContext): TemplateResult => {
      if (ui?.renderList === undefined || callOperation === undefined) return html`<p class="muted">This page needs a newer PI WEB on this device.</p>`;
      rerender.global = () => { context.host.requestRender(); };
      const reading = allReading(context.machine.id, PAGE_REFRESH_MS, context.host.shown?.() !== false);
      const model = globalListModel({
        read: reading.read,
        workspaces: reading.value?.workspaces,
        skippedWorkspaces: reading.value?.skippedWorkspaces ?? 0,
        rows: rowOptions(`global\u0000${context.machine.id}`, undefined, () => html`<div style="color:var(--pi-muted)">Read-only here: open a session in this folder to act on the goal.</div>`),
      });
      return ui.renderList({ ...model, notes: [...model.notes ?? [], ...readNotes(ui, reading)] });
    };

    const renderSessionLabel = (context: ListItemContext): TemplateResult | undefined => {
      const item = context.item;
      if (item.list !== "sessions" || callOperation === undefined) return undefined;
      rerender.labels.set(item.machineId, context.requestRender);
      const reading = allReading(item.machineId, LABEL_REFRESH_MS, true);
      const goals = reading.value?.workspaces.flatMap((workspace) => workspace.goals) ?? [];
      return sessionLabel(html, goals.filter((goal) => goal.sessionId === item.sessionId), reading.read === "failed");
    };

    const stopTimer = (): void => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };

    const unsubscribers = [
      activation.on?.("page-shown", ({ pageId }) => {
        if (pageId !== workspacePageId && pageId !== globalPageId) return;
        shownPage = pageId;
        timer ??= setInterval(() => { (shownPage === globalPageId ? rerender.global : rerender.workspace)?.(); }, PAGE_REFRESH_MS);
        rerenderAll();
      }),
      activation.on?.("page-hidden", ({ pageId }) => {
        if (pageId !== shownPage) return;
        shownPage = undefined;
        stopTimer();
      }),
      activation.on?.("session-activity-settled", () => {
        workspaceReadings.invalidateAll();
        allReadings.invalidateAll();
        rerenderAll();
      }),
    ];

    return {
      contributions: {
        workspacePanels: [{
          id: WORKSPACE_PAGE,
          title: "Goals",
          icon: goalIcon(svg),
          order: 400,
          fronts: GOAL_SURFACE,
          badge: (context) => {
            const reading = workspaceReadings.peek(workspaceScope(context).key);
            if (reading?.read !== "ready") return undefined;
            const running = reading.value?.goals.filter((goal) => goal.status === "running").length ?? 0;
            return running > 0 ? running : undefined;
          },
          onInvalidate: (context) => { workspaceReadings.invalidate(workspaceScope(context).key); context.host.requestRender(); },
          toolbar: renderWorkspaceToolbar,
          render: renderWorkspacePage,
        }],
        globalPanels: [{
          id: GLOBAL_PAGE,
          title: "All goals",
          icon: goalIcon(svg),
          order: 400,
          fronts: GOAL_SURFACE,
          render: renderGlobalPage,
        }],
        listLabels: [{ id: "session-goal", list: "sessions", order: 400, render: renderSessionLabel }],
        toolRenderers: [
          { id: "goal-todo", toolName: "goal_todo", render: (view) => renderGoalTodoCall(html, view) },
          { id: "goal-plan", toolName: "goal_plan", render: (view) => renderGoalPlanCall(html, view) },
        ],
      },
      dispose: () => {
        stopTimer();
        for (const unsubscribe of unsubscribers) unsubscribe?.();
      },
    };
  },
};

export default plugin;
