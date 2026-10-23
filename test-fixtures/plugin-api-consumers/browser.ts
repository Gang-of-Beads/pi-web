import type { ComposerSendResult, FleetOpenResult, FleetSessionsSnapshot, JsonValue, PiWebPlugin, PluginButton, PluginHostUi, PluginPanelSession, PluginSessionCommandOutcome, SessionRunAskedBy, SessionRunOutcome, Workspace } from "@gang-of-beads/pi-web/plugin-api";

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Browser declaration fixture",
  activate: (context) => {
    const stopListening = context.sessions?.onDidEndRun((fact) => {
      const outcome: SessionRunOutcome = fact.outcome;
      const askedBy: SessionRunAskedBy = fact.askedBy ?? "unknown";
      console.info(fact.session.machineId, fact.session.sessionId, fact.session.workspaceId, outcome, askedBy);
    });
    const stopWatching = context.machines?.onDidChangeReachability((fact) => {
      console.info(fact.machine.id, fact.previous, fact.machine.reachability);
    });
    const stopShown = context.on?.("page-shown", (fact) => { console.info("shown", fact.pageId, fact.machineId); });
    const stopHidden = context.on?.("page-hidden", (fact) => { console.info("hidden", fact.pageId, fact.machineId); });
    return {
      contributions: {
        actions: [{
          id: "identity",
          title: context.pluginId,
          run: ({ selectWorkspaceTool }) => {
            selectWorkspaceTool(`${context.runtimePluginId}:workspace.fixture`);
          },
        }],
        composer: [{
          id: "toggle.fixture",
          slot: "trailing",
          title: "Fixture toggle",
          presentation: (composer) => ({ pressed: composer.busy, title: composer.busy ? "Stop" : "Start" }),
          run: async (composer) => {
            composer.replaceDraft("Continue");
            const sent: ComposerSendResult | undefined = await composer.send?.();
            if (sent !== "sent") composer.notify(`Not sent: ${sent ?? "this PI WEB cannot send"}`, "info");
            composer.requestUpdate();
          },
        }],
        messageActions: [{
          id: "row.fixture",
          title: "Fixture action",
          icon: context.html`<span>F</span>`,
          roles: ["assistant"],
          available: (row) => !row.streaming && row.text !== "",
          presentation: (row) => ({ pressed: row.messageId === "pressed" }),
          run: (row) => { console.info(row.machineId, row.sessionId, row.cwd, row.role, row.text.length); row.requestUpdate(); },
        }],
        listLabels: [{
          id: "list.label.fixture",
          list: "machines",
          render: ({ item }) => (item.list === "machines" && item.machine.reachability === "online" ? context.html`<span>${item.machine.name}</span>` : undefined),
        }],
        listActions: [{
          id: "list.action.fixture",
          list: "sessions",
          actions: ({ item, requestRender }) => (item.list === "sessions" ? [{ id: "copy", title: "Copy session id", run: () => { console.info(item.machineId, item.sessionId); requestRender(); } }] : []),
        }],
        listSections: [{
          id: "list.section.fixture",
          list: "projects",
          sections: () => [{ id: "repos", title: "Repositories", order: 200, foldedByDefault: false, claims: (item) => item.list === "projects" && item.path?.startsWith("/repos/") === true }],
        }],
        workspacePanels: [{
          id: "workspace.fixture",
          title: "Fixture page",
          render: ({ host, session }) => context.html`<p>${host.shown?.() === false ? "hidden" : "shown"} ${session?.id ?? "no session"} ${session?.cwd ?? ""} ${session?.path ?? ""}</p>`,
        }],
        globalPanels: [{
          id: "global.fleet",
          title: "Fleet",
          scope: "fleet",
          render: ({ fleet }) => {
            const machines = fleet?.machines().machines ?? [];
            const boards: FleetSessionsSnapshot[] = machines.map((machine) => fleet?.sessions(machine.id) ?? { machineId: machine.id, coverage: "unloaded", sessions: [] });
            return context.html`<ul>${boards.map((board) => context.html`<li>${board.machineId} ${board.coverage} ${board.sessions.length}</li>`)}</ul>`;
          },
        }],
      },
      dispose: () => {
        stopListening?.();
        stopWatching?.();
        stopShown?.();
        stopHidden?.();
      },
    };
  },
};

async function openPinned(open: (target: { machineId: string; sessionId: string }) => Promise<FleetOpenResult>): Promise<boolean> {
  return (await open({ machineId: "local", sessionId: "pinned" })) === "opened";
}

function renderStop(ui: PluginHostUi | undefined, stop: () => void) {
  const button: PluginButton = { label: "Stop", tone: "danger", run: stop };
  return ui?.renderButton?.(button);
}

async function stopDeploy(session: PluginPanelSession, deployId: string): Promise<string> {
  const outcome: PluginSessionCommandOutcome | undefined = await session.runCommand?.({ sessionId: session.id, name: "deploy-stop", args: deployId });
  if (outcome === undefined) return "sessionCommands not declared";
  return outcome.kind === "ran" ? outcome.notices.map((notice) => notice.message).join("\n") : outcome.kind;
}

const echoJson = (value: JsonValue): JsonValue => value;
export { echoJson, openPinned, plugin, renderStop, stopDeploy };
export type BrowserWorkspace = Workspace;
