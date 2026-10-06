import type { HtmlTemplateTag, PiWebPlugin, PluginActivationContext, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { subagentListModel, type SubagentListState } from "./runRows.js";
import { RunsRead, type RunsView } from "./runsRead.js";
import { followedAfter, runsActivityOf, runsPollingDecision, UNSEEN_ANSWERS_BEFORE_STOP, type FollowedActivity, type RunsActivity } from "./runsPolling.js";
import { defineOnScreenMarker } from "./onScreenMarker.js";
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

function renderRuns(html: HtmlTemplateTag, ui: PluginActivationContext["ui"], view: RunsView | undefined) {
  if (ui?.renderList === undefined) return html`<p class="muted">This list needs a newer PI WEB on this device.</p>`;
  return ui.renderList(subagentListModel(view?.state, view?.refreshFailed === true));
}

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Subagents",
  activate: (context: PluginActivationContext) => {
    const { html, svg } = context;
    const callOperation = context.callOperation;
    let requestUpdate: () => void = () => undefined;
    let polling: ReturnType<typeof setInterval> | undefined;
    let followed: { readonly sessionFile: string; readonly activity: RunsActivity } | undefined;
    let unseenAnswers = 0;
    let panelShown: boolean | undefined;
    const runs = new RunsRead(
      (sessionFile) => (callOperation === undefined ? Promise.reject(new Error("no operations")) : callOperation("runs.list", { sessionFile })),
      () => {
        unseenAnswers += 1;
        requestUpdate();
      },
    );
    const stopPolling = (): void => {
      clearInterval(polling);
      polling = undefined;
    };
    /**
     * Each answer asks the host to draw, and that draw follows again while the panel or its
     * badge is on screen. Answers nobody drew mean nothing shows the runs any more (the chat is
     * open): stop, and forget what was seen so the next look reads. A read still on its way is
     * no evidence either way, so a stalled read never stops a watched poll.
     */
    const poll = (): void => {
      if (unseenAnswers >= UNSEEN_ANSWERS_BEFORE_STOP) {
        stopPolling();
        followed = undefined;
        return;
      }
      runs.tick();
    };
    context.on?.("session-activity-settled", () => { followed = undefined; });
    const onScreen = (shown: boolean): void => {
      if (panelShown === shown) return;
      panelShown = shown;
      if (shown) requestUpdate();
    };
    const shownFor = (panel: WorkspacePanelContext): SubagentListState | undefined => {
      const sessionFile = sessionFileOf(panel);
      return sessionFile === undefined ? undefined : runs.view(sessionFile)?.state;
    };

    /**
     * Read the session the host is showing. The panel's render and the tab's badge both ask, so
     * the poll follows the selected session even while the panel is closed; it used to stay on
     * the last session the panel drew (reads F7). A render of the panel while it is off screen
     * is not a look: it reads nothing and keeps nothing alive.
     */
    const follow = (panel: WorkspacePanelContext, looking = true): string | undefined => {
      const sessionFile = sessionFileOf(panel);
      if (sessionFile === undefined) return undefined;
      requestUpdate = () => { panel.host.requestRender(); };
      if (!looking) return sessionFile;
      unseenAnswers = 0;
      const switched = runs.select(sessionFile);
      const previous: FollowedActivity = followed?.sessionFile === sessionFile ? followed.activity : "unfollowed";
      const activity = runsActivityOf(panel.state?.status);
      const decision = runsPollingDecision(previous, activity);
      followed = { sessionFile, activity: followedAfter(previous, activity) };
      if (decision.read && !switched) runs.refresh();
      if (decision.poll) polling ??= setInterval(poll, 3000);
      else stopPolling();
      return sessionFile;
    };

    const ensure = (panel: WorkspacePanelContext): RunsView | undefined => {
      const sessionFile = follow(panel, panelShown !== false);
      if (sessionFile === undefined) return { state: { kind: "unknown", reason: "Open a session to see its subagents." }, refreshFailed: false };
      return runs.view(sessionFile);
    };

    defineSupervisorCard();
    defineOnScreenMarker();
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
            icon: svg`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.5"></circle><circle cx="5" cy="19" r="2.5"></circle><circle cx="19" cy="19" r="2.5"></circle><path d="M12 7.5v4"></path><path d="M12 11.5 6.5 16.8"></path><path d="M12 11.5l5.5 5.3"></path></svg>`,
            order: 60,
            badge: (panel) => {
              follow(panel);
              const state = shownFor(panel);
              return state?.kind === "rows" && state.running > 0 ? state.running : undefined;
            },
            render: (panel) => html`<pi-subagents-on-screen .onChange=${onScreen}></pi-subagents-on-screen>${renderRuns(html, context.ui, ensure(panel))}`,
          },
        ],
      },
      dispose: stopPolling,
    };
  },
};

export default plugin;
