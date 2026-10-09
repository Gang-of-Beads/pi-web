import type { PiWebPlugin, PluginActivationContext, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { backgroundRunCountOf, backgroundRunNote } from "./backgroundRunNote.js";
import { noticeLabel, taskNotice } from "./taskNotice.js";
import { backgroundListModel } from "./backgroundTaskRows.js";
import { TasksReader, type TaskScope, type TasksView } from "./tasksRead.js";

/** The selected session's working directory and transcript; a session with no transcript yet has no scope. */
function scopeOf(panel: WorkspacePanelContext): TaskScope | undefined {
  const selected = panel.state?.selectedSession;
  const cwd = selected?.cwd;
  const sessionFile = selected?.path;
  if (cwd === undefined || cwd === "" || sessionFile === undefined || sessionFile === "") return undefined;
  return { cwd, sessionFile };
}

/** The facts that move when the session's tasks do: read again when one changes. */
function readKeyOf(panel: WorkspacePanelContext): string {
  const status = panel.state?.status;
  return `${String(status?.backgroundRunCount ?? 0)}:${String(status?.isStreaming === true)}`;
}

/** A session that has no transcript yet can own no task on disk. */
const NO_TRANSCRIPT: TasksView = { tasks: [], read: "read" };

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Background Runs",
  activate: (context: PluginActivationContext) => {
    const { html, svg, ui } = context;
    const callOperation = context.callOperation;
    let requestUpdate: () => void = () => undefined;
    const reader = new TasksReader(
      (scope) => (callOperation === undefined ? Promise.reject(new Error("no operations")) : callOperation("tasks.list", { cwd: scope.cwd, sessionFile: scope.sessionFile })),
      () => { requestUpdate(); },
    );
    context.on?.("session-activity-settled", () => {
      reader.forget();
      requestUpdate();
    });
    /** The panel and the tab's badge both ask, so the read follows the selected session while the panel is closed too. */
    const viewOf = (panel: WorkspacePanelContext): TasksView => {
      requestUpdate = () => { panel.host.requestRender(); };
      const scope = scopeOf(panel);
      if (scope === undefined) return NO_TRANSCRIPT;
      reader.follow(scope, readKeyOf(panel));
      return reader.viewFor(scope.sessionFile);
    };
    return {
    contributions: {
      workspacePanels: [
        {
          id: "workspace.background",
          title: "Background",
          icon: svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></svg>`,
          order: 65,
          visible: (context) => context.state?.selectedSession !== undefined,
          badge: (panel) => {
            const running = viewOf(panel).tasks.filter((task) => task.status === "running").length;
            return running === 0 ? undefined : running;
          },
          render: (panel) => {
            const view = viewOf(panel);
            return ui?.renderList === undefined
              ? html`<p class="muted">This list needs a newer PI WEB on this device.</p>`
              : ui.renderList(backgroundListModel(view.tasks, view.read));
          },
        },
      ],
      messageRenderers: [
        {
          id: "message.background-task-notification",
          tag: "background-task-notification",
          render: (view) => html`<strong>Background task</strong><div>${noticeLabel(taskNotice(view.payload))}</div>`,
        },
      ],
      activityNotes: [
        {
          id: "activity.background-runs",
          order: 100,
          note: (activity) => backgroundRunNote(backgroundRunCountOf(activity.status)),
        },
      ],
    },
    };
  },
};

export default plugin;
