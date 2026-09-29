import type { HtmlTemplateTag, PiWebPlugin, PluginActivationContext, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { runPresentation, type SubagentListState } from "./runRows.js";
import { RunsRead, type RunsView } from "./runsRead.js";
import { defineSupervisorCard } from "./supervisorCardElement.js";
import { answeredReply, supervisorRequest } from "./supervisorRequest.js";
import { noticeSummary } from "./noticeSummary.js";

const NOTICE_TAGS = [
  "subagent-notify",
  "subagent-incremental-child-notify",
  "subagent_control_notice",
  "subagent_steering_notice",
  "subagent_supervisor_reply",
  "subagent-compaction-resume",
];

/**
 * The runs this session started, listed in the browser.
 *
 * The reader lives in this plugin's server half, so the whole feature - facts,
 * operation and panel - is one unit. Reads are per session (`RunsRead`): a list
 * fetched for one conversation must never render under another (the scope rule
 * the host surfaces follow).
 */
function sessionFileOf(context: WorkspacePanelContext): string | undefined {
  const state: unknown = context.state;
  if (typeof state !== "object" || state === null) return undefined;
  const selected: unknown = Reflect.get(state, "selectedSession");
  if (typeof selected !== "object" || selected === null) return undefined;
  const path: unknown = Reflect.get(selected, "path");
  return typeof path === "string" && path !== "" ? path : undefined;
}

function renderRuns(html: HtmlTemplateTag, view: RunsView | undefined) {
  const state: SubagentListState | undefined = view?.state;
  if (state === undefined) return html`<p class="empty" role="status">Reading this session's subagents…</p>`;
  if (state.kind === "unknown") return html`<p class="empty" role="status">${state.reason}</p>`;
  if (state.kind === "empty") return html`<p class="empty" role="status">This session has started no subagents.</p>`;
  return html`
    ${view?.refreshFailed === true ? html`<p class="empty" role="status">Could not refresh - showing the last read.</p>` : null}
    <ul class="list subagent-runs">
      ${state.rows.map((row) => {
        const presentation = runPresentation(row);
        return html`
          <li class=${`subagent-run ${presentation.tone}`}>
            <span class="subagent-run-name">${row.agent}</span>
            <span class=${`subagent-run-status ${presentation.tone}`}>${presentation.label}</span>
            <span class="subagent-run-detail">${presentation.detail}</span>
            ${row.task === undefined ? null : html`<span class="subagent-run-task">${row.task}</span>`}
          </li>
        `;
      })}
    </ul>
  `;
}

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Subagents",
  activate: (context: PluginActivationContext) => {
    const { html } = context;
    const callOperation = context.callOperation;
    let requestUpdate: () => void = () => undefined;
    let polling: ReturnType<typeof setInterval> | undefined;
    const runs = new RunsRead(
      (sessionFile) => (callOperation === undefined ? Promise.reject(new Error("no operations")) : callOperation("runs.list", { sessionFile })),
      () => { requestUpdate(); },
    );
    const shownFor = (panel: WorkspacePanelContext): SubagentListState | undefined => {
      const sessionFile = sessionFileOf(panel);
      return sessionFile === undefined ? undefined : runs.view(sessionFile)?.state;
    };

    /**
     * Read the session the host is showing. The panel's render and the tab's badge both ask, so
     * the poll follows the selected session even while the panel is closed; it used to stay on
     * the last session the panel drew (reads F7).
     */
    const follow = (panel: WorkspacePanelContext): string | undefined => {
      const sessionFile = sessionFileOf(panel);
      if (sessionFile === undefined) return undefined;
      requestUpdate = () => { panel.host.requestRender(); };
      runs.select(sessionFile);
      // A run list goes stale by the second while children work, so the panel
      // keeps re-reading; the tab's running count depends on it too.
      polling ??= setInterval(() => { runs.tick(); }, 3000);
      return sessionFile;
    };

    const ensure = (panel: WorkspacePanelContext): RunsView | undefined => {
      const sessionFile = follow(panel);
      if (sessionFile === undefined) return { state: { kind: "unknown", reason: "Open a session to see its subagents." }, refreshFailed: false };
      return runs.view(sessionFile);
    };

    defineSupervisorCard();
    return {
      contributions: {
        messageRenderers: [
          {
            id: "message.supervisor-request",
            tag: "subagent_supervisor_request",
            render: (view) => {
              const request = supervisorRequest(view.payload);
              return html`<pi-subagent-supervisor-card
                .request=${request}
                .answered=${answeredReply(request, view.followingUserTexts ?? [])}
                .onSend=${view.sendMessage}
                .onInsert=${view.insertIntoComposer}
              ></pi-subagent-supervisor-card>`;
            },
          },
          ...NOTICE_TAGS.map((tag) => ({
            id: `message.${tag.replace(/_/gu, "-")}`,
            tag,
            render: (view: { payload: unknown }) => {
              const summary = noticeSummary(tag, view.payload);
              return html`<strong>${summary.title}</strong>${summary.detail === undefined ? null : html`<small>${summary.detail}</small>`}`;
            },
          })),
        ],
        workspacePanels: [
          {
            id: "workspace.subagents",
            title: "Subagents",
            order: 60,
            badge: (panel) => {
              follow(panel);
              const state = shownFor(panel);
              return state?.kind === "rows" && state.running > 0 ? state.running : undefined;
            },
            summary: (panel) => {
              const state = shownFor(panel);
              if (state?.kind !== "rows") return undefined;
              return state.running > 0 ? `${String(state.running)} working` : `${String(state.rows.length)} finished`;
            },
            render: (panel) => renderRuns(html, ensure(panel)),
          },
        ],
      },
    };
  },
};

export default plugin;
