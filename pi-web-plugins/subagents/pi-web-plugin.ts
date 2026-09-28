import type { HtmlTemplateTag, PiWebPlugin, PluginActivationContext, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { runPresentation, subagentListState, type SubagentListState } from "./runRows.js";
import { defineSupervisorCard } from "./supervisorCardElement.js";
import { supervisorRequest } from "./supervisorRequest.js";
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
 * operation and panel - is one unit. Reads are per session and answered into a
 * cache keyed by that session: a list fetched for one conversation must never
 * render under another (the scope rule the host surfaces follow).
 */
interface RunsCache {
  sessionFile: string;
  state: SubagentListState | undefined;
}

function sessionFileOf(context: WorkspacePanelContext): string | undefined {
  const state: unknown = context.state;
  if (typeof state !== "object" || state === null) return undefined;
  const selected: unknown = Reflect.get(state, "selectedSession");
  if (typeof selected !== "object" || selected === null) return undefined;
  const path: unknown = Reflect.get(selected, "path");
  return typeof path === "string" && path !== "" ? path : undefined;
}

function renderRuns(html: HtmlTemplateTag, state: SubagentListState | undefined) {
  if (state === undefined) return html`<p class="empty" role="status">Reading this session's subagents…</p>`;
  if (state.kind === "unknown") return html`<p class="empty" role="status">${state.reason}</p>`;
  if (state.kind === "empty") return html`<p class="empty" role="status">This session has started no subagents.</p>`;
  return html`
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
    let cache: RunsCache | undefined;
    let polling: ReturnType<typeof setInterval> | undefined;

    const read = (sessionFile: string, requestUpdate: () => void): void => {
      if (callOperation === undefined) return;
      void callOperation("runs.list", { sessionFile })
        .then((answer) => {
          if (cache?.sessionFile !== sessionFile) return;
          cache = { sessionFile, state: subagentListState(answer) };
          requestUpdate();
        })
        .catch(() => {
          if (cache?.sessionFile !== sessionFile) return;
          cache = { sessionFile, state: { kind: "unknown", reason: "This machine could not be asked for the runs." } };
          requestUpdate();
        });
    };

    const ensure = (panel: WorkspacePanelContext): SubagentListState | undefined => {
      const sessionFile = sessionFileOf(panel);
      if (sessionFile === undefined) return { kind: "unknown", reason: "Open a session to see its subagents." };
      const requestUpdate = () => { panel.host.requestRender(); };
      if (cache?.sessionFile !== sessionFile) {
        cache = { sessionFile, state: undefined };
        read(sessionFile, requestUpdate);
      }
      // A run list goes stale by the second while children work, so the panel
      // re-reads while it is the one on screen.
      polling ??= setInterval(() => {
        const current = cache?.sessionFile;
        if (current !== undefined) read(current, requestUpdate);
      }, 3000);
      return cache.state;
    };

    defineSupervisorCard();
    return {
      contributions: {
        messageRenderers: [
          {
            id: "message.supervisor-request",
            tag: "subagent_supervisor_request",
            render: (view) => html`<pi-subagent-supervisor-card
              .request=${supervisorRequest(view.payload)}
              .onSend=${view.sendMessage}
              .onInsert=${view.insertIntoComposer}
            ></pi-subagent-supervisor-card>`,
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
              const state = cache?.sessionFile === sessionFileOf(panel) ? cache?.state : undefined;
              return state?.kind === "rows" && state.running > 0 ? state.running : undefined;
            },
            summary: (panel) => {
              const state = cache?.sessionFile === sessionFileOf(panel) ? cache?.state : undefined;
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
