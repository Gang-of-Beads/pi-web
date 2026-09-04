import { html, type TemplateResult } from "lit";
import type { DrawerSectionContext, PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { rememberGoalsHostUi } from "./browser/hostUi.js";
import { defineGoalPanel } from "./browser/defineGoalPanel.js";
import { GoalsReader } from "./browser/goalsReader.js";
import { goalsForKey } from "./browser/goalsLoad.js";
import type { GoalRecordSummary } from "./browser/goalTypes.js";

/**
 * Goals as a plugin.
 *
 * The records live in a workspace's own directory, so the plugin reads them
 * itself through its own operation rather than being handed rows by the host:
 * a feature whose view lives here and whose state lives in the host is the
 * split this boundary exists to remove.
 *
 * Absence stays three states. A workspace that has been read and has no goals
 * says so; a workspace nobody has read yet cannot, and says that instead.
 */

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Goals",
  activate: (context) => {
    rememberGoalsHostUi(context.ui);
    defineGoalPanel();

    let notify: (() => void) | undefined;
    let disposed = false;
    const reader = new GoalsReader(
      context.callOperation ?? (() => Promise.reject(new Error("This host does not offer plugin requests."))),
      () => { if (!disposed) notify?.(); },
    );
    let readFor: string | undefined;
    let commandInFlight = false;

    function readKey(context: DrawerSectionContext): string {
      return `${context.machineId}\u0000${context.workspacePath ?? ""}\u0000${context.sessionCwd ?? ""}`;
    }

    function sectionFor(section: DrawerSectionContext): TemplateResult {
      const workspacePath = section.workspacePath;
      if (workspacePath === undefined) return html`<div class="goals-unknown">No workspace is selected.</div>`;
      const key = readKey(section);
      notify = section.requestUpdate;
      if (readFor !== key) {
        readFor = key;
        void reader.read(workspacePath, section.sessionCwd);
      }
      const run = section.runCommand;
      const callOperation = context.callOperation;
      return html`<goal-panel
        .goalsLoad=${goalsForKey(reader.current(), workspacePath)}
        .canRunCommands=${run !== undefined}
        .commandInFlight=${commandInFlight}
        .onRefresh=${() => { void reader.read(workspacePath, section.sessionCwd); }}
        .onRunCommand=${run === undefined ? undefined : (goal: GoalRecordSummary, command: string) => {
          commandInFlight = true;
          notify?.();
          void run(command).finally(() => {
            commandInFlight = false;
            void reader.read(workspacePath, section.sessionCwd);
          });
          void goal;
        }}
        .onArchive=${(goal: GoalRecordSummary) => {
          void (callOperation?.("goals.archive", { workspacePath, goalId: goal.id }) ?? Promise.resolve())
            .then(() => reader.read(workspacePath, section.sessionCwd));
        }}
      ></goal-panel>`;
    }

    return {
      contributions: {
        drawerSections: [{
          id: "goals",
          title: "Goals",
          order: 30,
          available: (section) => availability(reader.current(), section),
          badge: (section) => badgeFor(reader.current(), section),
          render: sectionFor,
        }],
      },
      dispose: () => { disposed = true; notify = undefined; },
    };
  },
};

/**
 * Three states, keyed by where the answer was asked for: a read in flight or
 * never started cannot say (the tab stays), a read that found goals says yes,
 * and a completed empty read says no so the shell can drop the block.
 */
function availability(answer: { state: string; key: string | undefined; data: readonly GoalRecordSummary[] }, section: DrawerSectionContext): boolean | undefined {
  if (section.workspacePath === undefined) return false;
  if (answer.state === "loaded") return answer.data.length > 0;
  return undefined;
}

function badgeFor(answer: { key: string | undefined; data: readonly GoalRecordSummary[] }, section: DrawerSectionContext): number | undefined {
  if (section.workspacePath === undefined || answer.key !== section.workspacePath) return undefined;
  return answer.data.length === 0 ? undefined : answer.data.length;
}

export default plugin;
