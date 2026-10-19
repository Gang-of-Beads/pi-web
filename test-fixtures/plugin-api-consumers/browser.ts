import type { FleetOpenResult, FleetSessionsSnapshot, JsonValue, PiWebPlugin, PluginButton, PluginHostUi, SessionRunOutcome, Workspace } from "@gang-of-beads/pi-web/plugin-api";

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Browser declaration fixture",
  activate: (context) => {
    const stopListening = context.sessions?.onDidEndRun((fact) => {
      const outcome: SessionRunOutcome = fact.outcome;
      console.info(fact.session.machineId, fact.session.sessionId, fact.session.workspaceId, outcome);
    });
    const stopWatching = context.machines?.onDidChangeReachability((fact) => {
      console.info(fact.machine.id, fact.previous, fact.machine.reachability);
    });
    return {
      contributions: {
        actions: [{
          id: "identity",
          title: context.pluginId,
          run: ({ selectWorkspaceTool }) => {
            selectWorkspaceTool(`${context.runtimePluginId}:workspace.fixture`);
          },
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

const echoJson = (value: JsonValue): JsonValue => value;
export { echoJson, openPinned, plugin, renderStop };
export type BrowserWorkspace = Workspace;
